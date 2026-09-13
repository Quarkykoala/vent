export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      users: {
        Row: {
          id: string;
          auth_user_id: string;
          handle: string;
          age_verified_at: string | null;
          status: 'active' | 'suspended' | 'deletion_pending' | 'deleted';
          created_at: string;
        };
        Insert: {
          id?: string;
          auth_user_id: string;
          handle: string;
          age_verified_at?: string;
          status?: 'active' | 'suspended' | 'deletion_pending' | 'deleted';
          created_at?: string;
        };
        Update: {
          id?: string;
          auth_user_id?: string;
          handle?: string;
          age_verified_at?: string;
          status?: 'active' | 'suspended' | 'deletion_pending' | 'deleted';
          created_at?: string;
        };
      };
      listener_profiles: {
        Row: {
          id: string;
          user_id: string;
          display_name: string;
          status: 'applicant' | 'training' | 'active' | 'paused' | 'suspended' | 'rejected';
          tier: 'listener' | 'counsellor';
          languages: string[];
          topics: string[];
          verified_at: string | null;
          training_expires_at: string | null;
          quality_prior: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          display_name: string;
          status?: 'applicant' | 'training' | 'active' | 'paused' | 'suspended' | 'rejected';
          tier?: 'listener' | 'counsellor';
          languages: string[];
          topics: string[];
          verified_at?: string | null;
          training_expires_at?: string | null;
          quality_prior?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          display_name?: string;
          status?: 'applicant' | 'training' | 'active' | 'paused' | 'suspended' | 'rejected';
          tier?: 'listener' | 'counsellor';
          languages?: string[];
          topics?: string[];
          verified_at?: string | null;
          training_expires_at?: string | null;
          quality_prior?: number;
          created_at?: string;
        };
      };
      listener_presence: {
        Row: {
          listener_id: string;
          state: 'offline' | 'available' | 'reserved' | 'in_session';
          heartbeat_at: string;
          available_since: string | null;
          current_reservation_id: string | null;
          version: number;
        };
        Insert: {
          listener_id: string;
          state?: 'offline' | 'available' | 'reserved' | 'in_session';
          heartbeat_at?: string;
          available_since?: string | null;
          current_reservation_id?: string | null;
          version?: number;
        };
        Update: {
          listener_id?: string;
          state?: 'offline' | 'available' | 'reserved' | 'in_session';
          heartbeat_at?: string;
          available_since?: string | null;
          current_reservation_id?: string | null;
          version?: number;
        };
      };
      support_requests: {
        Row: {
          id: string;
          user_id: string;
          topic: string;
          language: string;
          service_tier: 'listener' | 'counsellor';
          state: string;
          payment_order_id: string | null;
          created_at: string;
          queued_at: string | null;
          matched_at: string | null;
          expires_at: string | null;
          idempotency_key: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          topic: string;
          language: string;
          service_tier?: 'listener' | 'counsellor';
          state?: string;
          payment_order_id?: string | null;
          created_at?: string;
          queued_at?: string | null;
          matched_at?: string | null;
          expires_at?: string | null;
          idempotency_key: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          topic?: string;
          language?: string;
          service_tier?: 'listener' | 'counsellor';
          state?: string;
          payment_order_id?: string | null;
          created_at?: string;
          queued_at?: string | null;
          matched_at?: string | null;
          expires_at?: string | null;
          idempotency_key?: string;
        };
      };
      match_reservations: {
        Row: {
          id: string;
          request_id: string;
          listener_id: string;
          state: 'offered' | 'accepted' | 'declined' | 'expired' | 'cancelled';
          score: number;
          score_components: Json;
          offered_at: string;
          expires_at: string;
          accepted_at: string | null;
        };
        Insert: {
          id?: string;
          request_id: string;
          listener_id: string;
          state?: 'offered' | 'accepted' | 'declined' | 'expired' | 'cancelled';
          score: number;
          score_components?: Json;
          offered_at?: string;
          expires_at: string;
          accepted_at?: string | null;
        };
        Update: {
          id?: string;
          request_id?: string;
          listener_id?: string;
          state?: 'offered' | 'accepted' | 'declined' | 'expired' | 'cancelled';
          score?: number;
          score_components?: Json;
          offered_at?: string;
          expires_at?: string;
          accepted_at?: string | null;
        };
      };
      sessions: {
        Row: {
          id: string;
          request_id: string;
          user_id: string;
          listener_id: string;
          state: 'created' | 'connecting' | 'active' | 'ended' | 'failed' | 'safety_ended';
          room_name: string;
          started_at: string | null;
          ended_at: string | null;
          duration_seconds: number | null;
          end_reason: string | null;
        };
        Insert: {
          id?: string;
          request_id: string;
          user_id: string;
          listener_id: string;
          state?: 'created' | 'connecting' | 'active' | 'ended' | 'failed' | 'safety_ended';
          room_name: string;
          started_at?: string | null;
          ended_at?: string | null;
          duration_seconds?: number | null;
          end_reason?: string | null;
        };
        Update: {
          id?: string;
          request_id?: string;
          user_id?: string;
          listener_id?: string;
          state?: 'created' | 'connecting' | 'active' | 'ended' | 'failed' | 'safety_ended';
          room_name?: string;
          started_at?: string | null;
          ended_at?: string | null;
          duration_seconds?: number | null;
          end_reason?: string | null;
        };
      };
      ratings: {
        Row: {
          id: string;
          session_id: string;
          user_id: string;
          listener_id: string;
          stars: number;
          reason_tags: string[];
          created_at: string;
        };
        Insert: {
          id?: string;
          session_id: string;
          user_id: string;
          listener_id: string;
          stars: number;
          reason_tags?: string[];
          created_at?: string;
        };
        Update: {
          id?: string;
          session_id?: string;
          user_id?: string;
          listener_id?: string;
          stars?: number;
          reason_tags?: string[];
          created_at?: string;
        };
      };
      blocks: {
        Row: {
          blocker_id: string;
          blocked_id: string;
          reason_code: string | null;
          created_at: string;
        };
        Insert: {
          blocker_id: string;
          blocked_id: string;
          reason_code?: string | null;
          created_at?: string;
        };
        Update: {
          blocker_id?: string;
          blocked_id?: string;
          reason_code?: string | null;
          created_at?: string;
        };
      };
      payments: {
        Row: {
          id: string;
          user_id: string;
          provider: string;
          provider_order_id: string;
          provider_payment_id: string | null;
          amount_paise: number;
          currency: string;
          state: string;
          created_at: string;
          captured_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          provider?: string;
          provider_order_id: string;
          provider_payment_id?: string | null;
          amount_paise: number;
          currency?: string;
          state?: string;
          created_at?: string;
          captured_at?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          provider?: string;
          provider_order_id?: string;
          provider_payment_id?: string | null;
          amount_paise?: number;
          currency?: string;
          state?: string;
          created_at?: string;
          captured_at?: string | null;
        };
      };
      ledger_entries: {
        Row: {
          id: string;
          event_id: string;
          account_code: string;
          direction: 'debit' | 'credit';
          amount_paise: number;
          currency: string;
          reference_type: string;
          reference_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          event_id: string;
          account_code: string;
          direction: 'debit' | 'credit';
          amount_paise: number;
          currency?: string;
          reference_type: string;
          reference_id: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          event_id?: string;
          account_code?: string;
          direction?: 'debit' | 'credit';
          amount_paise?: number;
          currency?: string;
          reference_type?: string;
          reference_id?: string;
          created_at?: string;
        };
      };
      safety_cases: {
        Row: {
          id: string;
          session_id: string;
          opened_by: string;
          severity: 'review' | 'urgent' | 'emergency';
          state: 'open' | 'acknowledged' | 'escalated' | 'resolved';
          reason_codes: string[];
          supervisor_id: string | null;
          opened_at: string;
          acknowledged_at: string | null;
          resolved_at: string | null;
          resolution_code: string | null;
        };
        Insert: {
          id?: string;
          session_id: string;
          opened_by: string;
          severity: 'review' | 'urgent' | 'emergency';
          state?: 'open' | 'acknowledged' | 'escalated' | 'resolved';
          reason_codes: string[];
          supervisor_id?: string | null;
          opened_at?: string;
          acknowledged_at?: string | null;
          resolved_at?: string | null;
          resolution_code?: string | null;
        };
        Update: {
          id?: string;
          session_id?: string;
          opened_by?: string;
          severity?: 'review' | 'urgent' | 'emergency';
          state?: 'open' | 'acknowledged' | 'escalated' | 'resolved';
          reason_codes?: string[];
          supervisor_id?: string | null;
          opened_at?: string;
          acknowledged_at?: string | null;
          resolved_at?: string | null;
          resolution_code?: string | null;
        };
      };
      audit_events: {
        Row: {
          id: number;
          actor_id: string | null;
          actor_role: string;
          action: string;
          entity_type: string;
          entity_id: string;
          metadata: Json;
          ip_hash: string | null;
          created_at: string;
        };
        Insert: {
          id?: number;
          actor_id?: string | null;
          actor_role: string;
          action: string;
          entity_type: string;
          entity_id: string;
          metadata?: Json;
          ip_hash?: string | null;
          created_at?: string;
        };
        Update: {
          id?: number;
          actor_id?: string | null;
          actor_role?: string;
          action?: string;
          entity_type?: string;
          entity_id?: string;
          metadata?: Json;
          ip_hash?: string | null;
          created_at?: string;
        };
      };
      idempotency_keys: {
        Row: {
          key: string;
          operation: string;
          response: Json;
          created_at: string;
        };
        Insert: {
          key: string;
          operation: string;
          response?: Json;
          created_at?: string;
        };
        Update: {
          key?: string;
          operation?: string;
          response?: Json;
          created_at?: string;
        };
      };
    };
  };
}
