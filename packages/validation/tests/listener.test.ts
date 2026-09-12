import { describe, it, expect } from 'vitest';
import {
  CreateListenerProfileSchema,
  ToggleListenerPresenceSchema,
} from '../src/index';

describe('Phase 2 — Listener Validation Schemas', () => {
  it('validates creation of listener profile with allowed languages and topics', () => {
    const valid = {
      userId: '550e8400-e29b-41d4-a716-446655440000',
      displayName: 'Aarav (Trained Listener)',
      tier: 'listener',
      languages: ['English', 'Hindi'],
      topics: ['Relationship Conflict', 'Work & Career Stress'],
    };
    expect(CreateListenerProfileSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects unsupported topics or languages', () => {
    const invalid = {
      userId: '550e8400-e29b-41d4-a716-446655440000',
      displayName: 'Aarav',
      languages: ['Spanish'], // Not in MVP
      topics: ['Relationship Conflict'],
    };
    expect(CreateListenerProfileSchema.safeParse(invalid).success).toBe(false);
  });

  it('validates presence toggle between available and offline', () => {
    expect(
      ToggleListenerPresenceSchema.safeParse({
        listenerId: '550e8400-e29b-41d4-a716-446655440000',
        desiredState: 'available',
      }).success
    ).toBe(true);

    expect(
      ToggleListenerPresenceSchema.safeParse({
        listenerId: '550e8400-e29b-41d4-a716-446655440000',
        desiredState: 'in_session', // Direct toggle to in_session from client is forbidden!
      }).success
    ).toBe(false);
  });
});
