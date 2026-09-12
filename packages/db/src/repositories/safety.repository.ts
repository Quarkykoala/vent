import type { TypedSupabaseClient } from '../client';
import type { Database } from '../types';
import { SafetyCaseState } from '@vent/domain';

export type SafetyCaseRow = Database['public']['Tables']['safety_cases']['Row'];

export class SafetyRepository {
  constructor(private client: TypedSupabaseClient) {}

  /**
   * Atomically creates a safety case, immediately terminates active sessions
   * with safety_ended, frees the listener presence, and writes an audit event.
   * Fully idempotent: duplicate reports for the same session return the existing case.
   */
  async createCase(params: {
    sessionId: string;
    openedBy: string;
    severity: 'review' | 'urgent' | 'emergency';
    reasonCodes: string[];
    reporterRole?: string;
  }): Promise<{ id: string; sessionId: string; severity: string; state: string; idempotentReplay?: boolean }> {
    const rawClient = this.client as any;
    const { data, error } = await rawClient.rpc('atomic_create_safety_case', {
      p_session_id: params.sessionId,
      p_reporter_user_id: params.openedBy,
      p_severity: params.severity,
      p_reason_codes: params.reasonCodes,
      p_reporter_role: params.reporterRole || 'listener',
    });

    if (error) {
      throw new Error(`Database error creating safety case: ${error.message}`);
    }

    if (!data || !data.success) {
      throw new Error(data?.error || 'Failed to create safety case');
    }

    return {
      id: data.case_id,
      sessionId: data.session_id,
      severity: data.severity,
      state: data.state,
      idempotentReplay: data.idempotent_replay || false,
    };
  }

  async acknowledgeCase(
    caseId: string,
    supervisorId: string,
    actorRole = 'clinical_supervisor'
  ): Promise<void> {
    const rawClient = this.client as any;
    const now = new Date().toISOString();

    const { error: updErr } = await rawClient
      .from('safety_cases')
      .update({
        state: SafetyCaseState.ACKNOWLEDGED,
        supervisor_id: supervisorId,
        acknowledged_at: now,
      })
      .eq('id', caseId);

    if (updErr) {
      throw new Error(`Failed to acknowledge safety case: ${updErr.message}`);
    }

    // The audit row records the caller's real role, not an assumed one.
    await rawClient.from('audit_events').insert({
      actor_id: supervisorId,
      actor_role: actorRole,
      action: 'safety_case_acknowledged',
      entity_type: 'safety_case',
      entity_id: caseId,
      metadata: { supervisorId },
      created_at: now,
    });
  }

  async resolveCase(params: {
    caseId: string;
    supervisorId: string;
    resolutionCode: string;
    actorRole?: string;
  }): Promise<void> {
    const rawClient = this.client as any;
    const now = new Date().toISOString();

    const { error: updErr } = await rawClient
      .from('safety_cases')
      .update({
        state: SafetyCaseState.RESOLVED,
        supervisor_id: params.supervisorId,
        resolved_at: now,
        resolution_code: params.resolutionCode,
      })
      .eq('id', params.caseId);

    if (updErr) {
      throw new Error(`Failed to resolve safety case: ${updErr.message}`);
    }

    await rawClient.from('audit_events').insert({
      actor_id: params.supervisorId,
      actor_role: params.actorRole ?? 'clinical_supervisor',
      action: 'safety_case_resolved',
      entity_type: 'safety_case',
      entity_id: params.caseId,
      metadata: { resolutionCode: params.resolutionCode },
      created_at: now,
    });
  }
}
