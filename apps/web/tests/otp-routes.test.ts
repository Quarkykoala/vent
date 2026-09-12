import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { UserRole } from '@vent/domain';

const boundary = vi.hoisted(() => ({
  sendOtp: vi.fn(),
  verifyOtp: vi.fn(),
}));

vi.mock('@/features/auth/auth-service', () => ({
  authService: {
    sendOtp: boundary.sendOtp,
    verifyOtp: boundary.verifyOtp,
  },
}));

import { POST as sendPost } from '../src/app/api/auth/otp/send/route';
import { POST as verifyPost } from '../src/app/api/auth/otp/verify/route';

function makeRequest(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('OTP routes — send and age-gated verify', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    boundary.sendOtp.mockReset();
    boundary.verifyOtp.mockReset();
  });

  it('send rejects a non-Indian number with 400', async () => {
    const res = await sendPost(makeRequest('http://localhost:3000/api/auth/otp/send', { phone: '+15551234567' }));
    expect(res.status).toBe(400);
    expect(boundary.sendOtp).not.toHaveBeenCalled();
  });

  it('send dispatches via the auth service for a valid Indian number', async () => {
    boundary.sendOtp.mockResolvedValue({ success: true, message: 'OTP sent successfully to +919876543210' });
    const res = await sendPost(
      makeRequest('http://localhost:3000/api/auth/otp/send', { phone: '+919876543210' })
    );
    expect(res.status).toBe(200);
    expect(boundary.sendOtp).toHaveBeenCalledWith('+919876543210');
  });

  it('send surfaces rate limiting without leaking provider details', async () => {
    boundary.sendOtp.mockRejectedValue(new Error('Too many requests. Wait a moment and try again.'));
    const res = await sendPost(
      makeRequest('http://localhost:3000/api/auth/otp/send', { phone: '+919876543210' })
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/too many requests/i);
  });

  it('verify requires explicit age confirmation', async () => {
    const res = await verifyPost(
      makeRequest('http://localhost:3000/api/auth/otp/verify', {
        phone: '+919876543210',
        code: '123456',
        ageConfirmed: false,
      })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/age/i);
    expect(boundary.verifyOtp).not.toHaveBeenCalled();
  });

  it('verify rejects a malformed code without calling the provider', async () => {
    const res = await verifyPost(
      makeRequest('http://localhost:3000/api/auth/otp/verify', {
        phone: '+919876543210',
        code: '12',
        ageConfirmed: true,
      })
    );
    expect(res.status).toBe(400);
    expect(boundary.verifyOtp).not.toHaveBeenCalled();
  });

  it('verify returns the session token on success', async () => {
    boundary.verifyOtp.mockResolvedValue({
      session: {
        userId: '11111111-1111-1111-1111-111111111111',
        authUserId: '00000000-0000-0000-0000-000000000001',
        handle: 'CalmRiver123',
        role: UserRole.USER,
        token: 'session_jwt_123',
        mfaVerified: false,
      },
    });
    const res = await verifyPost(
      makeRequest('http://localhost:3000/api/auth/otp/verify', {
        phone: '+919876543210',
        code: '123456',
        ageConfirmed: true,
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.session.token).toBe('session_jwt_123');
    expect(body.session.handle).toBe('CalmRiver123');
  });

  it('verify surfaces an invalid code as 401 with a clear message', async () => {
    boundary.verifyOtp.mockRejectedValue(new Error('Invalid code. Check the code and try again.'));
    const res = await verifyPost(
      makeRequest('http://localhost:3000/api/auth/otp/verify', {
        phone: '+919876543210',
        code: '000000',
        ageConfirmed: true,
      })
    );
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/invalid code/i);
  });
});
