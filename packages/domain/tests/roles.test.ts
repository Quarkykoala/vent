import { describe, it, expect } from 'vitest';
import {
  UserRole,
  hasPermission,
  assertRolePermission,
  InvariantViolationError,
} from '../src/index';

describe('Phase 1 — Role Hierarchy & Access Control Matrix', () => {
  it('prevents regular users and listeners from accessing admin console', () => {
    expect(hasPermission(UserRole.USER, 'canAccessAdminConsole')).toBe(false);
    expect(hasPermission(UserRole.LISTENER, 'canAccessAdminConsole')).toBe(false);
    expect(hasPermission(UserRole.COUNSELLOR, 'canAccessAdminConsole')).toBe(false);

    expect(() =>
      assertRolePermission(UserRole.USER, 'canAccessAdminConsole')
    ).toThrow(InvariantViolationError);
  });

  it('enforces privacy partition: finance cannot see clinical safety cases', () => {
    expect(hasPermission(UserRole.FINANCE, 'canViewSafetyCases')).toBe(false);
    expect(hasPermission(UserRole.FINANCE, 'canApprovePayouts')).toBe(true);

    expect(() =>
      assertRolePermission(UserRole.FINANCE, 'canViewSafetyCases', true)
    ).toThrow(/lacks permission 'canViewSafetyCases'/);
  });

  it('enforces privacy partition: support agents cannot view sensitive clinical safety cases', () => {
    expect(hasPermission(UserRole.SUPPORT_AGENT, 'canViewSafetyCases')).toBe(false);
    expect(hasPermission(UserRole.SUPPORT_AGENT, 'canInitiateRefunds')).toBe(true);
  });

  it('allows clinical supervisors to view and resolve safety cases', () => {
    expect(hasPermission(UserRole.CLINICAL_SUPERVISOR, 'canViewSafetyCases')).toBe(true);
    expect(hasPermission(UserRole.CLINICAL_SUPERVISOR, 'canResolveSafetyCases')).toBe(true);
    // Supervisors cannot approve financial payouts
    expect(hasPermission(UserRole.CLINICAL_SUPERVISOR, 'canApprovePayouts')).toBe(false);
  });

  it('enforces MFA requirement on all privileged staff roles', () => {
    // Attempting access without MFA verified must fail
    expect(() =>
      assertRolePermission(UserRole.SUPER_ADMIN, 'canAccessAdminConsole', false)
    ).toThrow(/requires verified multi-factor authentication/);

    // With MFA verified, passes
    expect(() =>
      assertRolePermission(UserRole.SUPER_ADMIN, 'canAccessAdminConsole', true)
    ).not.toThrow();
  });
});
