import { describe, it, expect } from 'vitest';
import {
  SupportRequestState,
  MatchReservationState,
  SessionState,
  PaymentState,
  SafetyCaseState,
  ListenerPresenceState,
  transitionSupportRequest,
  isSupportRequestTransitionAllowed,
  transitionMatchReservation,
  isMatchReservationTransitionAllowed,
  transitionSession,
  isSessionTransitionAllowed,
  transitionPayment,
  isPaymentTransitionAllowed,
  transitionSafetyCase,
  isSafetyCaseTransitionAllowed,
  transitionListenerPresence,
  isListenerPresenceTransitionAllowed,
  DomainTransitionError,
} from '../src/index';

describe('Domain State Machines', () => {
  describe('SupportRequest State Machine', () => {
    it('allows valid normal path: created -> paid -> queued -> reserved -> accepted -> connected -> completed', () => {
      const id = 'req-123';
      let state = SupportRequestState.CREATED;

      state = transitionSupportRequest({ requestId: id, currentState: state, nextState: SupportRequestState.PAID });
      expect(state).toBe(SupportRequestState.PAID);

      state = transitionSupportRequest({ requestId: id, currentState: state, nextState: SupportRequestState.QUEUED });
      expect(state).toBe(SupportRequestState.QUEUED);

      state = transitionSupportRequest({ requestId: id, currentState: state, nextState: SupportRequestState.RESERVED });
      expect(state).toBe(SupportRequestState.RESERVED);

      state = transitionSupportRequest({ requestId: id, currentState: state, nextState: SupportRequestState.ACCEPTED });
      expect(state).toBe(SupportRequestState.ACCEPTED);

      state = transitionSupportRequest({ requestId: id, currentState: state, nextState: SupportRequestState.CONNECTED });
      expect(state).toBe(SupportRequestState.CONNECTED);

      state = transitionSupportRequest({ requestId: id, currentState: state, nextState: SupportRequestState.COMPLETED });
      expect(state).toBe(SupportRequestState.COMPLETED);
    });

    it('allows decline and offer expiry to requeue', () => {
      const id = 'req-requeue';
      // Reserved -> Declined -> Queued
      const declined = transitionSupportRequest({
        requestId: id,
        currentState: SupportRequestState.RESERVED,
        nextState: SupportRequestState.DECLINED,
      });
      expect(declined).toBe(SupportRequestState.DECLINED);

      const requeued = transitionSupportRequest({
        requestId: id,
        currentState: declined,
        nextState: SupportRequestState.QUEUED,
      });
      expect(requeued).toBe(SupportRequestState.QUEUED);

      // Reserved -> Offer Expired -> Queued
      const expired = transitionSupportRequest({
        requestId: id,
        currentState: SupportRequestState.RESERVED,
        nextState: SupportRequestState.OFFER_EXPIRED,
      });
      expect(expired).toBe(SupportRequestState.OFFER_EXPIRED);

      const requeued2 = transitionSupportRequest({
        requestId: id,
        currentState: expired,
        nextState: SupportRequestState.QUEUED,
      });
      expect(requeued2).toBe(SupportRequestState.QUEUED);
    });

    it('allows safety escalation from connected', () => {
      const next = transitionSupportRequest({
        requestId: 'req-safety',
        currentState: SupportRequestState.CONNECTED,
        nextState: SupportRequestState.SAFETY_ESCALATED,
      });
      expect(next).toBe(SupportRequestState.SAFETY_ESCALATED);
    });

    it('rejects invalid jump from created directly to completed', () => {
      expect(() => {
        transitionSupportRequest({
          requestId: 'req-bad',
          currentState: SupportRequestState.CREATED,
          nextState: SupportRequestState.COMPLETED,
        });
      }).toThrow(DomainTransitionError);
    });

    it('rejects any transition from terminal states', () => {
      expect(isSupportRequestTransitionAllowed(SupportRequestState.COMPLETED, SupportRequestState.QUEUED)).toBe(false);
      expect(isSupportRequestTransitionAllowed(SupportRequestState.CANCELLED, SupportRequestState.PAID)).toBe(false);
      expect(isSupportRequestTransitionAllowed(SupportRequestState.PAYMENT_FAILED, SupportRequestState.RESERVED)).toBe(false);
    });
  });

  describe('MatchReservation State Machine', () => {
    it('allows offered -> accepted', () => {
      const next = transitionMatchReservation({
        reservationId: 'res-1',
        currentState: MatchReservationState.OFFERED,
        nextState: MatchReservationState.ACCEPTED,
      });
      expect(next).toBe(MatchReservationState.ACCEPTED);
    });

    it('allows offered -> declined / expired / cancelled', () => {
      for (const st of [
        MatchReservationState.DECLINED,
        MatchReservationState.EXPIRED,
        MatchReservationState.CANCELLED,
      ]) {
        expect(isMatchReservationTransitionAllowed(MatchReservationState.OFFERED, st)).toBe(true);
      }
    });

    it('rejects transition from accepted to declined', () => {
      expect(() => {
        transitionMatchReservation({
          reservationId: 'res-2',
          currentState: MatchReservationState.ACCEPTED,
          nextState: MatchReservationState.DECLINED,
        });
      }).toThrow(DomainTransitionError);
    });
  });

  describe('Session State Machine', () => {
    it('allows created -> connecting -> active -> ended', () => {
      const sid = 'sess-1';
      let state = SessionState.CREATED;
      state = transitionSession({ sessionId: sid, currentState: state, nextState: SessionState.CONNECTING });
      state = transitionSession({ sessionId: sid, currentState: state, nextState: SessionState.ACTIVE });
      state = transitionSession({ sessionId: sid, currentState: state, nextState: SessionState.ENDED });
      expect(state).toBe(SessionState.ENDED);
    });

    it('allows active -> safety_ended', () => {
      const next = transitionSession({
        sessionId: 'sess-safety',
        currentState: SessionState.ACTIVE,
        nextState: SessionState.SAFETY_ENDED,
      });
      expect(next).toBe(SessionState.SAFETY_ENDED);
    });

    it('rejects created directly to ended', () => {
      expect(() => {
        transitionSession({
          sessionId: 'sess-bad',
          currentState: SessionState.CREATED,
          nextState: SessionState.ENDED,
        });
      }).toThrow(DomainTransitionError);
    });
  });

  describe('Payment State Machine', () => {
    it('allows created -> authorized -> captured -> refunded', () => {
      const pid = 'pay-1';
      let state = PaymentState.CREATED;
      state = transitionPayment({ paymentId: pid, currentState: state, nextState: PaymentState.AUTHORIZED });
      state = transitionPayment({ paymentId: pid, currentState: state, nextState: PaymentState.CAPTURED });
      state = transitionPayment({ paymentId: pid, currentState: state, nextState: PaymentState.REFUNDED });
      expect(state).toBe(PaymentState.REFUNDED);
    });

    it('allows created directly to captured (webhook direct capture)', () => {
      const next = transitionPayment({
        paymentId: 'pay-2',
        currentState: PaymentState.CREATED,
        nextState: PaymentState.CAPTURED,
      });
      expect(next).toBe(PaymentState.CAPTURED);
    });

    it('rejects refunded to captured', () => {
      expect(() => {
        transitionPayment({
          paymentId: 'pay-3',
          currentState: PaymentState.REFUNDED,
          nextState: PaymentState.CAPTURED,
        });
      }).toThrow(DomainTransitionError);
    });
  });

  describe('SafetyCase State Machine', () => {
    it('allows open -> acknowledged -> escalated -> resolved', () => {
      const cid = 'case-1';
      let state = SafetyCaseState.OPEN;
      state = transitionSafetyCase({ caseId: cid, currentState: state, nextState: SafetyCaseState.ACKNOWLEDGED });
      state = transitionSafetyCase({ caseId: cid, currentState: state, nextState: SafetyCaseState.ESCALATED });
      state = transitionSafetyCase({ caseId: cid, currentState: state, nextState: SafetyCaseState.RESOLVED });
      expect(state).toBe(SafetyCaseState.RESOLVED);
    });

    it('rejects resolved to open', () => {
      expect(() => {
        transitionSafetyCase({
          caseId: 'case-2',
          currentState: SafetyCaseState.RESOLVED,
          nextState: SafetyCaseState.OPEN,
        });
      }).toThrow(DomainTransitionError);
    });
  });

  describe('ListenerPresence State Machine', () => {
    it('allows offline -> available -> reserved -> in_session -> available', () => {
      const lid = 'list-1';
      let state = ListenerPresenceState.OFFLINE;
      state = transitionListenerPresence({ listenerId: lid, currentState: state, nextState: ListenerPresenceState.AVAILABLE });
      state = transitionListenerPresence({ listenerId: lid, currentState: state, nextState: ListenerPresenceState.RESERVED });
      state = transitionListenerPresence({ listenerId: lid, currentState: state, nextState: ListenerPresenceState.IN_SESSION });
      state = transitionListenerPresence({ listenerId: lid, currentState: state, nextState: ListenerPresenceState.AVAILABLE });
      expect(state).toBe(ListenerPresenceState.AVAILABLE);
    });

    it('rejects offline directly to in_session', () => {
      expect(() => {
        transitionListenerPresence({
          listenerId: 'list-2',
          currentState: ListenerPresenceState.OFFLINE,
          nextState: ListenerPresenceState.IN_SESSION,
        });
      }).toThrow(DomainTransitionError);
    });
  });
});
