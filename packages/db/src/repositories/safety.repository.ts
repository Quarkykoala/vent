import type { TypedSupabaseClient } from '../client';
import type { Database } from '../types';
import {
  SafetyCaseState,


} from '@vent/domain';

export type SafetyCaseRow = Database['public']['Tables']['safety_cases']['Row'];

export class SafetyRepository {
  constructor(private client: TypedSupabaseClient) {}

  async createCase(params: {
    sessionId: string;
    openedBy: string;
    severity: 'review' | 'urgent' | 'emergency';
    reasonCodes: string[];
  }): Promise<SafetyCaseRow> {
    const rawClient = this.client as any;
    const now = new Date().toISOString();

    const { data, error } = await rawClient
      .from('safety_cases')
      .insert({
        session_id: params.sessionId,
        opened_by: params.openedBy,
        severity: params.severity,
        reason_codes: params.reasonCodes,
        state: SafetyCaseState.OPEN,
        opened_at: now,
      })
      .select()
      .single();

    if (error || !data) {
      throw new Error(`Failed to create safety case: ${error?.message}`);
    }

    // Append-only audit log entry
    await rawClient.from('audit_events').insert({
      actor_id: params.openedBy,
      actor_role: 'listener',
      action: 'safety_case_opened',
      entity_type: 'safety_case',
      entity_id: data.id,
      metadata: { severity: params.severity, reasonCodes: params.reasonCodes },
      created_at: now,
    });

    return data as SafetyCaseRow;
  }

  async acknowledgeCase(caseId: string, supervisorId: string): Promise<void> {
    const rawClient = this.client as any;
    const now = new Date().toISOString();

    await rawClient
      .from('safety_cases')
      .update({
        state: SafetyCaseState.ACKNOWLEDGED,
        supervisor_id: supervisorId,
        acknowledged_at: now,
      })
      .eq('id', caseId);

    await rawClient.from('audit_events').insert({
      actor_id: supervisorId,
      actor_role: 'clinical_supervisor',
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
  }): Promise<void> {
    const rawClient = this.client as any;
    const now = new Date().toISOString();

    await rawClient
      .from('safety_cases')
      .update({
        state: SafetyCaseState.RESOLVED,
        supervisor_id: params.supervisorId,
        resolved_at: now,
        resolution_code: params.resolutionCode,
      })
      .eq('id', params.caseId);

    await rawClient.from('audit_events').insert({
      actor_id: params.supervisorId,
      actor_role: 'clinical_supervisor',
      action: 'safety_case_resolved',
      entity_type: 'safety_case',
      entity_id: params.caseId,
      metadata: { resolutionCode: params.resolutionCode },
      created_at: now,
    });
  }
}
