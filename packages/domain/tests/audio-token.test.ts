import { describe, it, expect } from 'vitest';
import {
  validateRoomTokenConstraints,
  generateParticipantAlias,
  InvariantViolationError,
} from '../src/index';

describe('Audio Token Privacy & Security Invariants', () => {
  it('passes validation for compliant room token parameters', () => {
    expect(() => {
      validateRoomTokenConstraints({
        roomName: 'room-abc-123',
        participantAlias: 'user_a1b2c3d4',
        ttlSeconds: 600,
        canPublish: true,
        canSubscribe: true,
        canPublishData: false,
        recorder: false,
      });
    }).not.toThrow();
  });

  it('strictly rejects token when recorder is enabled', () => {
    expect(() => {
      validateRoomTokenConstraints({
        roomName: 'room-abc-123',
        participantAlias: 'user_a1b2c3d4',
        ttlSeconds: 600,
        canPublish: true,
        canSubscribe: true,
        canPublishData: false,
        recorder: true, // PROHIBITED INVARIANT
      });
    }).toThrow(InvariantViolationError);
  });

  it('rejects tokens exceeding maximum TTL (900 seconds)', () => {
    expect(() => {
      validateRoomTokenConstraints({
        roomName: 'room-abc-123',
        participantAlias: 'user_a1b2c3d4',
        ttlSeconds: 1200, // 20 mins > 15 mins
        canPublish: true,
        canSubscribe: true,
        canPublishData: false,
        recorder: false,
      });
    }).toThrow(InvariantViolationError);
  });

  it('generates pseudonymous participant aliases without exposing user phone or email', () => {
    const userAlias = generateParticipantAlias('user', '550e8400-e29b-41d4-a716-446655440000');
    expect(userAlias).toBe('user_550e8400');
    expect(userAlias).not.toContain('@');
    expect(userAlias).not.toContain('+91');

    const listenerAlias = generateParticipantAlias('listener', '987fcdeb-51a2-43f1-b823-112233445566');
    expect(listenerAlias).toBe('listener_987fcdeb');
  });
});
