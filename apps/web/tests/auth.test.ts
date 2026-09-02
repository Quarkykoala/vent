import { describe, it, expect } from 'vitest';
import { MockAuthService } from '../src/features/auth/auth-service';

describe('Phase 1 — Auth Integration & Privacy Guarantees', () => {
  it('allows user to sign in with OTP and receives pseudonymous handle', async () => {
    const service = new MockAuthService();
    const phone = '+919876543210';

    const sendRes = await service.sendOtp(phone);
    expect(sendRes.success).toBe(true);

    const verifyRes = await service.verifyOtp({
      phone,
      code: '123456',
      ageConfirmed: true,
    });

    expect(verifyRes.session).toBeDefined();
    expect(verifyRes.session.userId).toBeDefined();
    expect(verifyRes.session.handle).toMatch(/^[A-Z][a-z]+[A-Z][a-z]+\d{3}$/);
    expect(verifyRes.session.token).toBeDefined();

    // Verify handle contains NO phone number or sensitive email
    expect(verifyRes.session.handle).not.toContain('9876543210');
    expect(verifyRes.session.handle).not.toContain('@');
  });

  it('rejects OTP verification when age confirmation is not provided', async () => {
    const service = new MockAuthService();
    const phone = '+919876543210';
    await service.sendOtp(phone);

    await expect(
      service.verifyOtp({
        phone,
        code: '123456',
        ageConfirmed: false,
      })
    ).rejects.toThrow(/Age confirmation required/);
  });
});
