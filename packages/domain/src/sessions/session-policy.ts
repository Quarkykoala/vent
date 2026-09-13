/**
 * Session duration policy.
 *
 * The approved MVP envelope (ACCEPTED_MVP_RISKS.md RISK-006) is a fixed
 * 20-minute audio session with automatic disconnect and presence release. The
 * cap is server-owned: the operations worker ends any session that has run past
 * it, and the room-token endpoint refuses to extend a session beyond it.
 */
export const SESSION_CAP_SECONDS = 1200;

export const SESSION_CAP_MS = SESSION_CAP_SECONDS * 1000;

/** Seconds left before the cap, clamped at zero. */
export function remainingSessionSeconds(
  startedAtIso: string | null | undefined,
  nowMs: number = Date.now()
): number {
  if (!startedAtIso) return SESSION_CAP_SECONDS;
  const startedMs = new Date(startedAtIso).getTime();
  if (Number.isNaN(startedMs)) return SESSION_CAP_SECONDS;
  const elapsed = Math.floor((nowMs - startedMs) / 1000);
  return Math.max(0, SESSION_CAP_SECONDS - elapsed);
}

export function isSessionPastCap(
  startedAtIso: string | null | undefined,
  nowMs: number = Date.now()
): boolean {
  return remainingSessionSeconds(startedAtIso, nowMs) <= 0 && Boolean(startedAtIso);
}
