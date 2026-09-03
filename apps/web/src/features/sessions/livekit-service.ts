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
}

export const livekitService = new LiveKitService();
