import { describe, it, expect } from 'vitest';
import { ListenerHeartbeatSchema, ToggleListenerPresenceSchema } from '@vent/validation';

describe('Phase 2 — Web Listener Presence Endpoints', () => {
  it('validates heartbeat schema input', () => {
    const valid = { listenerId: '550e8400-e29b-41d4-a716-446655440000' };
    expect(ListenerHeartbeatSchema.safeParse(valid).success).toBe(true);
  });

  it('validates presence toggle payload', () => {
    const valid = {
      listenerId: '550e8400-e29b-41d4-a716-446655440000',
      desiredState: 'available',
    };
    expect(ToggleListenerPresenceSchema.safeParse(valid).success).toBe(true);
  });
});
