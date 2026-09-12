# Operations scheduler (required, not yet automated)

The application exposes idempotent operations entrypoints, but no background
scheduler calls them automatically. Until a scheduler is configured, an
operator or cron-like worker must invoke these endpoints:

- `POST /api/operations/reservation-expiry` `{ reservationId }` as
  `listener_ops` or `super_admin` — expires a past-TTL offer exactly once.
  The customer waiting screen also triggers lazy expiry through the match
  endpoint, so expiry still converges without the scheduler, only slower.
- `POST /api/operations/maintenance` `{ staleSeconds? }` as `listener_ops`
  or `super_admin` — sweeps stale `available` presence to `offline`. Never
  touches listeners in session.

Recommended schedule: reservation-expiry sweep every 30s over open offers,
maintenance sweep every 60s. Trigger.dev is the planned runner
(`TECHNICAL_PLAN.md` §10); any authenticated cron worker works. Do not claim
automatic background execution until the scheduler is registered and observed.
