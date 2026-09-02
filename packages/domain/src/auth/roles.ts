import { UserRole, type UserRoleType } from '../enums';
import { InvariantViolationError } from '../errors';

export interface RolePermissions {
  canAccessAdminConsole: boolean;
  canViewSafetyCases: boolean;
  canResolveSafetyCases: boolean;
  canApprovePayouts: boolean;
  canInitiateRefunds: boolean;
  canManageListeners: boolean;
  canManagePrivacyRequests: boolean;
  requiresMfa: boolean;
}

export const ROLE_PERMISSIONS: Record<UserRoleType, RolePermissions> = {
  [UserRole.USER]: {
    canAccessAdminConsole: false,
    canViewSafetyCases: false,
    canResolveSafetyCases: false,
    canApprovePayouts: false,
    canInitiateRefunds: false,
    canManageListeners: false,
    canManagePrivacyRequests: false,
    requiresMfa: false,
  },
  [UserRole.LISTENER]: {
    canAccessAdminConsole: false,
    canViewSafetyCases: false,
    canResolveSafetyCases: false,
    canApprovePayouts: false,
    canInitiateRefunds: false,
    canManageListeners: false,
    canManagePrivacyRequests: false,
    requiresMfa: false,
  },
  [UserRole.COUNSELLOR]: {
    canAccessAdminConsole: false,
    canViewSafetyCases: false,
    canResolveSafetyCases: false,
    canApprovePayouts: false,
    canInitiateRefunds: false,
    canManageListeners: false,
    canManagePrivacyRequests: false,
    requiresMfa: false,
  },
  [UserRole.SUPPORT_AGENT]: {
    canAccessAdminConsole: true,
    canViewSafetyCases: false, // Support sees session status, not private safety notes
    canResolveSafetyCases: false,
    canApprovePayouts: false,
    canInitiateRefunds: true, // Propose refunds
    canManageListeners: false,
    canManagePrivacyRequests: false,
    requiresMfa: true,
  },
  [UserRole.LISTENER_OPS]: {
    canAccessAdminConsole: true,
    canViewSafetyCases: false,
    canResolveSafetyCases: false,
    canApprovePayouts: false,
    canInitiateRefunds: false,
    canManageListeners: true, // Verify, activate, suspend listeners
    canManagePrivacyRequests: false,
    requiresMfa: true,
  },
  [UserRole.CLINICAL_SUPERVISOR]: {
    canAccessAdminConsole: true,
    canViewSafetyCases: true,
    canResolveSafetyCases: true,
    canApprovePayouts: false,
    canInitiateRefunds: false,
    canManageListeners: true, // Can suspend listeners for clinical boundary violations
    canManagePrivacyRequests: false,
    requiresMfa: true,
  },
  [UserRole.FINANCE]: {
    canAccessAdminConsole: true,
    canViewSafetyCases: false, // Finance cannot see clinical/safety records
    canResolveSafetyCases: false,
    canApprovePayouts: true,
    canInitiateRefunds: true,
    canManageListeners: false,
    canManagePrivacyRequests: false,
    requiresMfa: true,
  },
  [UserRole.PRIVACY_ADMIN]: {
    canAccessAdminConsole: true,
    canViewSafetyCases: false,
    canResolveSafetyCases: false,
    canApprovePayouts: false,
    canInitiateRefunds: false,
    canManageListeners: false,
    canManagePrivacyRequests: true, // Data export & DPDP erasure workflows
    requiresMfa: true,
  },
  [UserRole.SUPER_ADMIN]: {
    canAccessAdminConsole: true,
    canViewSafetyCases: true,
    canResolveSafetyCases: true,
    canApprovePayouts: true,
    canInitiateRefunds: true,
    canManageListeners: true,
    canManagePrivacyRequests: true,
    requiresMfa: true,
  },
};

export function hasPermission(
  role: UserRoleType,
  permission: keyof RolePermissions
): boolean {
  return ROLE_PERMISSIONS[role]?.[permission] ?? false;
}

export function assertRolePermission(
  role: UserRoleType,
  permission: keyof RolePermissions,
  mfaVerified = false
): void {
  const perms = ROLE_PERMISSIONS[role];
  if (!perms || !perms[permission]) {
    throw new InvariantViolationError(
      `Access Denied: Role '${role}' lacks permission '${permission}'`
    );
  }

  if (perms.requiresMfa && !mfaVerified) {
    throw new InvariantViolationError(
      `Access Denied: Role '${role}' requires verified multi-factor authentication (MFA).`
    );
  }
}
