import crypto from 'node:crypto';
import {
  createRoomTokenClaims,
  generateParticipantAlias,
  type LiveKitTokenClaims,
} from '@vent/domain';

export interface GenerateTokenParams {
  roomName: string;
  role: 'user' | 'listener';
  sessionAliasId: string;
  ttlSeconds?: number;
}

export interface LiveKitTokenResult {
  token: string;
  url: string;
  participantAlias: string;
  expiresAt: string;
}

export class LiveKitService {
  private apiKey: string;
  private apiSecret: string;
  private livekitUrl: string;

  constructor(apiKey?: string, apiSecret?: string, livekitUrl?: string) {
    this.apiKey = apiKey || process.env.LIVEKIT_API_KEY || '';
    this.apiSecret = apiSecret || process.env.LIVEKIT_API_SECRET || '';
    this.livekitUrl = livekitUrl || process.env.LIVEKIT_URL || '';
  }

  isConfigured(): boolean {
    return (
      Boolean(this.apiKey) &&
      Boolean(this.apiSecret) &&
      Boolean(this.livekitUrl)
    );
  }

  /**
   * Generates a signed, short-lived LiveKit room token.
   * INVARIANT: Never enables recording, egress, or transcription.
   * STRICT FAIL-CLOSED: Rejects generation if credentials are unconfigured.
   */
  generateRoomToken(params: GenerateTokenParams): LiveKitTokenResult {
    if (!this.isConfigured()) {
      throw new Error('LiveKit credentials unconfigured (fail-closed invariant).');
    }

    const alias = generateParticipantAlias(params.role, params.sessionAliasId);
    const claims = createRoomTokenClaims({
      apiKey: this.apiKey,
      roomName: params.roomName,
      participantAlias: alias,
      ttlSeconds: params.ttlSeconds || 600, // 10 minutes default
    });

    const token = this.signClaims(claims);

    return {
      token,
      url: this.livekitUrl,
      participantAlias: alias,
      expiresAt: new Date(claims.exp * 1000).toISOString(),
    };
  }

  /**
   * Verifies and decodes a LiveKit JWT token.
   */
  verifyToken(token: string): LiveKitTokenClaims {
    if (!this.apiSecret) {
      throw new Error('Cannot verify token: LiveKit API secret unconfigured.');
    }

    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new Error('Invalid JWT format');
    }

    const [headerB64, payloadB64, sigB64] = parts;
    const dataToVerify = `${headerB64}.${payloadB64}`;

    const expectedSig = crypto
      .createHmac('sha256', this.apiSecret)
      .update(dataToVerify)
      .digest('base64url');

    if (sigB64 !== expectedSig) {
      throw new Error('Invalid token signature');
    }

    const payloadJson = Buffer.from(payloadB64!, 'base64url').toString('utf8');
    const claims: LiveKitTokenClaims = JSON.parse(payloadJson);

    // Check expiration
    if (claims.exp <= Math.floor(Date.now() / 1000)) {
      throw new Error('Token expired');
    }

    // STRICT INVARIANT: Check recording flag
    if (claims.video.record) {
      throw new Error('Prohibited recording token detected');
    }

    return claims;
  }

  private signClaims(claims: LiveKitTokenClaims): string {
    const header = { alg: 'HS256', typ: 'JWT' };
    const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
    const payloadB64 = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const signature = crypto
      .createHmac('sha256', this.apiSecret)
      .update(`${headerB64}.${payloadB64}`)
      .digest('base64url');

    return `${headerB64}.${payloadB64}.${signature}`;
  }

  /**
   * Signs a short-lived server-API token (room administration only).
   * Deliberately separate from participant tokens: it grants no media rights.
   */
  private signServerApiToken(ttlSeconds = 60): string {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const header = { alg: 'HS256', typ: 'JWT' };
    const payload = {
      iss: this.apiKey,
      sub: this.apiKey,
      nbf: nowSeconds - 5,
      exp: nowSeconds + ttlSeconds,
      // LiveKit server APIs need the room-admin grant.
      video: { roomAdmin: true, room: '*', roomCreate: false, roomJoin: false },
    };
    const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = crypto
      .createHmac('sha256', this.apiSecret)
      .update(`${headerB64}.${payloadB64}`)
      .digest('base64url');
    return `${headerB64}.${payloadB64}.${signature}`;
  }

  /**
   * Closes a room so a participant holding a still-valid token cannot rejoin
   * after the session reached a terminal state. Server-only, short-lived admin
   * token, no recording or egress involvement.
   *
   * Returns false when LiveKit is unconfigured or the call failed; callers must
   * treat teardown as best-effort — the database state is what forbids rejoin
   * (the token route refuses terminal sessions), and this is the transport-level
   * enforcement on top of it.
   */
  async deleteRoom(roomName: string): Promise<boolean> {
    if (!this.isConfigured()) return false;

    const httpUrl = this.livekitUrl.replace(/^ws/, 'http');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);

    try {
      const res = await fetch(`${httpUrl}/twirp/livekit.RoomService/DeleteRoom`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.signServerApiToken()}`,
        },
        body: JSON.stringify({ room: roomName }),
        signal: controller.signal,
      });
      return res.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }
}

export const livekitService = new LiveKitService();
