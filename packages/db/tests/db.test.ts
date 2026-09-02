import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createSupabaseClient, createSupabaseAdminClient } from '../src/index';
import fs from 'node:fs';
import path from 'node:path';

describe('Database Client & Schema Invariants', () => {
  const dummyUrl = 'https://dummy-project.supabase.co';
  const dummyAnon = 'dummy-anon-key-1234567890';
  const dummyService = 'dummy-service-role-key-1234567890';

  it('creates an anonymous/standard Supabase client successfully', () => {
    const client = createSupabaseClient({
      supabaseUrl: dummyUrl,
      supabaseAnonKey: dummyAnon,
    });
    expect(client).toBeDefined();
    expect(client.from).toBeDefined();
  });

  it('creates a service-role admin client in node environment', () => {
    const admin = createSupabaseAdminClient({
      supabaseUrl: dummyUrl,
      supabaseServiceRoleKey: dummyService,
    });
    expect(admin).toBeDefined();
  });

  it('strictly throws if service-role client is instantiated in a simulated browser environment', () => {
    // Simulate browser window
    (globalThis as any).window = {};
    try {
      expect(() => {
        createSupabaseAdminClient({
          supabaseUrl: dummyUrl,
          supabaseServiceRoleKey: dummyService,
        });
      }).toThrow(/Security Invariant Violation/);
    } finally {
      delete (globalThis as any).window;
    }
  });

  describe('SQL Migration Validations', () => {
    it('verifies core schema migration file exists and defines all required tables and constraints', () => {
      const migrationPath = path.resolve(
        process.cwd(),
        '../../supabase/migrations/20260902000001_core_schema.sql'
      );
      expect(fs.existsSync(migrationPath)).toBe(true);

      const sql = fs.readFileSync(migrationPath, 'utf8');

      // Check all 13 core tables are created
      const expectedTables = [
        'public.users',
        'public.listener_profiles',
        'public.listener_presence',
        'public.support_requests',
        'public.match_reservations',
        'public.sessions',
        'public.ratings',
        'public.blocks',
        'public.payments',
        'public.ledger_entries',
        'public.safety_cases',
        'public.audit_events',
        'public.idempotency_keys',
      ];

      for (const table of expectedTables) {
        expect(sql).toContain(`create table if not exists ${table}`);
      }

      // Check money stored in paise, never float
      expect(sql).toContain('amount_paise bigint');
      expect(sql).toContain('amount_paise > 0');

      // Check timestamps in UTC
      expect(sql).toContain("timezone('utc', now())");

      // Check unique pair constraint on blocks
      expect(sql).toContain('primary key (blocker_id, blocked_id)');
      expect(sql).toContain('check (blocker_id <> blocked_id)');
    });

    it('verifies RLS migration enables row level security and revokes public permissions', () => {
      const rlsPath = path.resolve(
        process.cwd(),
        '../../supabase/migrations/20260902000002_rls_policies.sql'
      );
      expect(fs.existsSync(rlsPath)).toBe(true);

      const sql = fs.readFileSync(rlsPath, 'utf8');

      // Check RLS enabled on core tables
      expect(sql).toContain('alter table public.users enable row level security;');
      expect(sql).toContain('alter table public.support_requests enable row level security;');
      expect(sql).toContain('alter table public.sessions enable row level security;');
      expect(sql).toContain('alter table public.payments enable row level security;');
      expect(sql).toContain('alter table public.safety_cases enable row level security;');

      // Check revocation from anon
      expect(sql).toContain('revoke all on all tables in schema public from anon;');

      // Check sensitive tables have NO grants to authenticated (service_role only)
      expect(sql).not.toContain('grant select on public.safety_cases to authenticated');
      expect(sql).not.toContain('grant select on public.ledger_entries to authenticated');
      expect(sql).not.toContain('grant select on public.audit_events to authenticated');
    });
  });
});
