import type { TypedSupabaseClient } from '../client';
import type { Database } from '../types';

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
  ): Promise<{ acknowledgedAt: string; idempotentReplay: boolean }> {
    const rawClient = this.client as any;
    const { data, error } = await rawClient.rpc('atomic_acknowledge_safety_case', {
      p_case_id: caseId,
      p_supervisor_id: supervisorId,
      p_actor_role: actorRole,
    });

    if (error) {
      throw new Error(`Failed to acknowledge safety case: ${error.message}`);
    }
    if (!data?.success) {
      throw new Error(`${data?.code ?? 'ACKNOWLEDGE_FAILED'}: ${data?.error ?? 'Failed to acknowledge safety case'}`);
    }

    return {
      acknowledgedAt: data.acknowledged_at,
      idempotentReplay: Boolean(data.idempotent_replay),
    };
  }

  async resolveCase(params: {
    caseId: string;
    supervisorId: string;
    resolutionCode: string;
    actorRole?: string;
  }): Promise<{ resolvedAt: string; idempotentReplay: boolean }> {
    const rawClient = this.client as any;
    const { data, error } = await rawClient.rpc('atomic_resolve_safety_case', {
      p_case_id: params.caseId,
      p_supervisor_id: params.supervisorId,
      p_resolution_code: params.resolutionCode,
      p_actor_role: params.actorRole ?? 'clinical_supervisor',
    });

    if (error) {
      throw new Error(`Failed to resolve safety case: ${error.message}`);
    }
    if (!data?.success) {
      throw new Error(`${data?.code ?? 'RESOLVE_FAILED'}: ${data?.error ?? 'Failed to resolve safety case'}`);
    }

    return {
      resolvedAt: data.resolved_at,
      idempotentReplay: Boolean(data.idempotent_replay),
    };
  }
}
