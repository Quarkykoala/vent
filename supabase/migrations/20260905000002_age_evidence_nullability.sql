-- Migration: 20260905000002_age_evidence_nullability.sql
-- Description: F08 repair — an 18+ confirmation timestamp is durable evidence of a
-- real age-gate interaction. Token-based provisioning must not fabricate one, so the
-- column becomes nullable; the timestamp is only written by the OTP verification
-- flow after an explicit ageConfirmed interaction. Support-request creation is
-- gated server-side on that evidence existing.

alter table public.users alter column age_verified_at drop not null;
