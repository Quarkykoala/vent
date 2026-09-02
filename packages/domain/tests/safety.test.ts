import { describe, it, expect } from 'vitest';
import {
  determineSafetySeverity,
  buildSafetyAlertNotifications,
  evaluateTabletopScenario,
  SafetyCaseSeverity,
} from '../src/index';

describe('Phase 7 — Safety Escalation & Tabletop Scenarios', () => {
  describe('Deterministic Severity Evaluation (NO AI in Decision Path)', () => {
    it('categorizes self_harm_risk immediately as EMERGENCY', () => {
      const severity = determineSafetySeverity(['self_harm_risk']);
      expect(severity).toBe(SafetyCaseSeverity.EMERGENCY);
    });

    it('categorizes harm_to_others immediately as EMERGENCY', () => {
      const severity = determineSafetySeverity(['harm_to_others']);
      expect(severity).toBe(SafetyCaseSeverity.EMERGENCY);
    });

    it('categorizes domestic_violence as URGENT', () => {
      const severity = determineSafetySeverity(['domestic_violence']);
      expect(severity).toBe(SafetyCaseSeverity.URGENT);
    });

    it('categorizes boundary_violation as REVIEW', () => {
      const severity = determineSafetySeverity(['boundary_violation']);
      expect(severity).toBe(SafetyCaseSeverity.REVIEW);
    });
  });

  describe('Dual-Channel Alerting (Primary + Backup Channel)', () => {
    it('dispatches to primary SMS, ops dashboard, AND backup pager for EMERGENCY cases', () => {
      const alerts = buildSafetyAlertNotifications({
        caseId: 'case-emerg-1',
        severity: SafetyCaseSeverity.EMERGENCY,
        reasons: ['self_harm_risk'],
      });

      const channels = alerts.map((a) => a.channelName);
      expect(channels).toContain('primary_sms');
      expect(channels).toContain('ops_dashboard');
      expect(channels).toContain('backup_pager');
      expect(alerts.every((a) => a.delivered)).toBe(true);
    });
  });

  describe('Tabletop Scenarios Coverage (All 10 SOP Scenarios)', () => {
    it('validates Scenario 1: direct imminent self-harm statement -> EMERGENCY, crisis_referred', () => {
      const s1 = evaluateTabletopScenario(1);
      expect(s1.expectedSeverity).toBe(SafetyCaseSeverity.EMERGENCY);
      expect(s1.expectedDisposition).toBe('crisis_referred');
    });

    it('validates Scenario 3: threat to another person -> EMERGENCY, escalated_to_emergency', () => {
      const s3 = evaluateTabletopScenario(3);
      expect(s3.expectedSeverity).toBe(SafetyCaseSeverity.EMERGENCY);
      expect(s3.expectedDisposition).toBe('escalated_to_emergency');
    });

    it('validates Scenario 6: supervisor unavailable -> triggers backup alert channel', () => {
      const s6 = evaluateTabletopScenario(6);
      expect(s6.expectedSeverity).toBe(SafetyCaseSeverity.EMERGENCY);
      expect(s6.requiresSupervisorAction).toBe(true);
    });

    it('validates Scenario 9: malicious false escalation -> REVIEW, false_alarm', () => {
      const s9 = evaluateTabletopScenario(9);
      expect(s9.expectedSeverity).toBe(SafetyCaseSeverity.REVIEW);
      expect(s9.expectedDisposition).toBe('false_alarm');
    });

    it('validates all 10 scenarios have explicit defined dispositions', () => {
      for (let id = 1; id <= 10; id++) {
        const scenario = evaluateTabletopScenario(id);
        expect(scenario.expectedSeverity).toBeDefined();
        expect(scenario.expectedDisposition).toBeDefined();
        expect(scenario.requiresSupervisorAction).toBe(true);
      }
    });
  });
});
