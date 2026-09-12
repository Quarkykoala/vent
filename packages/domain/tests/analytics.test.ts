import { describe, it, expect } from 'vitest';
import {
  createSafeAnalyticsEvent,
  sanitizeAnalyticsProperties,
  scrubUserDataForErasure,
} from '../src/index';

describe('Phase 10 — Privacy-Preserving Analytics & DPDP 2025 Compliance', () => {
  it('allows emission of allowlisted events with safe metadata', () => {
    const event = createSafeAnalyticsEvent({
      event: 'support_request_created',
      distinctId: 'user_pseudo_123',
      properties: {
        language: 'Hindi',
        topic: 'Work & Career Stress',
        latency_ms: 450,
      },
    });

    expect(event.event).toBe('support_request_created');
    expect(event.distinctId).toBe('user_pseudo_123');
    expect(event.properties.language).toBe('Hindi');
  });

  it('CRITICAL PRIVACY INVARIANT: Rejects events with prohibited sensitive keys (phone, email, story, transcript)', () => {
    // Attempting to log user phone
    expect(() =>
      sanitizeAnalyticsProperties({ user_phone: '+919876543210' })
    ).toThrow(/contains prohibited sensitive keyword 'phone'/);

    // Attempting to log user email
    expect(() =>
      sanitizeAnalyticsProperties({ user_email: 'test@example.com' })
    ).toThrow(/contains prohibited sensitive keyword 'email'/);

    // Attempting to log call transcript or audio
    expect(() =>
      sanitizeAnalyticsProperties({ audio_transcript: 'Hello listener...' })
    ).toThrow(/contains prohibited sensitive keyword 'transcript'/);

    // Attempting to log sensitive story free text
    expect(() =>
      sanitizeAnalyticsProperties({ user_story_text: 'I am feeling overwhelmed...' })
    ).toThrow(/contains prohibited sensitive keyword 'story'/);
  });

  it('rejects unapproved non-allowlisted events', () => {
    expect(() =>
      createSafeAnalyticsEvent({
        event: 'unauthorized_random_event' as any,
        distinctId: 'user_123',
        properties: {},
      })
    ).toThrow(/Only allowlisted events may be emitted/);
  });

  describe('DPDP 2025 Right to Erasure Scrubber', () => {
    it('irreversibly anonymizes personal handles and purges auth identity', () => {
      const originalUser = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        handle: 'SunlitRiver492',
        auth_user_id: 'auth_usr_9876543210',
      };

      const erased = scrubUserDataForErasure(originalUser);

      expect(erased.id).toBe(originalUser.id);
      expect(erased.handle).toBe('deleted_user_550e8400');
      expect(erased.handle).not.toContain('SunlitRiver');
      expect(erased.auth_user_id).toMatch(/^erased_/);
      expect(erased.auth_user_id).not.toContain('9876543210');
      expect(erased.status).toBe('deleted');
    });
  });
});
