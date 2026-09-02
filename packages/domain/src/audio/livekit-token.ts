import { InvariantViolationError } from '../errors';

export interface RoomTokenConstraints {
  roomName: string;
  participantAlias: string;
  ttlSeconds: number;
  canPublish: boolean;
  canSubscribe: boolean;
  canPublishData: boolean;
  recorder: boolean;
}

export const MAX_ROOM_TOKEN_TTL_SECONDS = 900; // 15 minutes

/**
 * Validates LiveKit room token configuration against privacy and security invariants.
 * Strictly forbids recording, egress, excessive TTLs, and leaking raw identity.
 */
export function validateRoomTokenConstraints(
  constraints: RoomTokenConstraints
): void {
  if (!constraints.roomName || constraints.roomName.trim().length === 0) {
    throw new InvariantViolationError('LiveKit room name must not be empty');
  }

  if (
    !constraints.participantAlias ||
    constraints.participantAlias.trim().length === 0
  ) {
    throw new InvariantViolationError(
      'Participant identity alias must not be empty'
    );
  }

  // Never allow recording or recorder flags
  if (constraints.recorder) {
    throw new InvariantViolationError(
      'Security invariant violation: Recording/egress must NEVER be enabled on LiveKit tokens.'
    );
  }

  // TTL must be short-lived
  if (
    constraints.ttlSeconds <= 0 ||
    constraints.ttlSeconds > MAX_ROOM_TOKEN_TTL_SECONDS
  ) {
    throw new InvariantViolationError(
      `Room token TTL (${constraints.ttlSeconds}s) exceeds maximum permitted limit (${MAX_ROOM_TOKEN_TTL_SECONDS}s).`
    );
  }

  // Audio-only check: Data publishing should be restricted
  if (constraints.canPublishData) {
    throw new InvariantViolationError(
      'Audio MVP invariant: Data publishing channel is restricted.'
    );
  }
}

/**
 * Generates an opaque participant alias for an audio session to ensure neither party sees
 * the other party's phone, email, or database user ID.
 */
export function generateParticipantAlias(
  role: 'user' | 'listener',
  sessionAliasId: string
): string {
  const shortId = sessionAliasId.replace(/-/g, '').slice(0, 8);
  return `${role}_${shortId}`;
}
