import { describe, it, expect } from 'vitest';
import { LiveKitService } from '../src/features/sessions/livekit-service';

describe('Phase 5 — Audio Call Privacy, Tokens & No-Recording Guards', () => {
  const service = new LiveKitService(
    'test_lk_key',
    'test_lk_secret_1234567890',
    'wss://test.livekit.cloud'
  );

  const sessionId = 'session-123-abc';
  const roomName = 'room_session123abc';

  it('generates valid scoped LiveKit tokens for user and listener', () => {
    const userTokenResult = service.generateRoomToken({
      roomName,
      role: 'user',
      sessionAliasId: sessionId,
      ttlSeconds: 600,
    });

    const listenerTokenResult = service.generateRoomToken({
      roomName,
      role: 'listener',
      sessionAliasId: sessionId,
      ttlSeconds: 600,
    });

    expect(userTokenResult.participantAlias).toBe('user_session1');
    expect(listenerTokenResult.participantAlias).toBe('listener_session1');

    // Decode and verify user token
    const userClaims = service.verifyToken(userTokenResult.token);
    expect(userClaims.sub).toBe('user_session1');
    expect(userClaims.video.room).toBe(roomName);
    expect(userClaims.video.canPublish).toBe(true);
    expect(userClaims.video.canSubscribe).toBe(true);

    // CRITICAL PRIVACY INVARIANT: Recording strictly prohibited
    expect(userClaims.video.record).toBe(false);
  });

  it('CRITICAL ACCEPTANCE: Rejects tokens with invalid signatures or tampering', () => {
    const validResult = service.generateRoomToken({
      roomName,
      role: 'user',
      sessionAliasId: sessionId,
    });

    const parts = validResult.token.split('.');
    const tampered = `${parts[0]}.${parts[1]}.badsignature`;

    expect(() => service.verifyToken(tampered)).toThrow(/Invalid token signature/);
  });

  it('CRITICAL ACCEPTANCE: Rejects expired room tokens', () => {
    const expiredClaims = {
      sub: 'user_123',
      iss: 'test_lk_key',
      exp: Math.floor(Date.now() / 1000) - 10, // Expired 10s ago
      video: {
        room: roomName,
        roomJoin: true,
        canPublish: true,
        canSubscribe: true,
        canPublishData: false,
        record: false,
      },
    };

    // Sign expired claims
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify(expiredClaims)).toString('base64url');
    const sig = require('node:crypto')
      .createHmac('sha256', 'test_lk_secret_1234567890')
      .update(`${header}.${payload}`)
      .digest('base64url');

    const expiredToken = `${header}.${payload}.${sig}`;
    expect(() => service.verifyToken(expiredToken)).toThrow(/Token expired/);
  });
});
