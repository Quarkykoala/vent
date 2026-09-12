import { fileURLToPath } from 'node:url';
import baseline from '../2026-09-06-glm-long-horizon-review/adversarial.config.mjs';

// Review-only instrumentation. It logs fixture ownership and state, without
// changing production code, assertions, matching behavior, or test scheduling.
const tests = fileURLToPath(new URL('../../../apps/web/tests/', import.meta.url)).replaceAll('\\', '/');

export default {
  ...baseline,
  plugins: [{
    name: 'review-shared-listener-pool-trace',
    enforce: 'pre',
    transform(code, id) {
      const normalized = id.replaceAll('\\', '/').split('?')[0];
      if (normalized === `${tests}matching-authorization.test.ts`) {
        const initialMarker = 'cleanup.reservationIds.push(body1.reservationId);';
        const rematchMarker = 'expect([200, 201]).toContain(res3.status);';
        if (!code.includes(initialMarker) || !code.includes(rematchMarker)) throw new Error('Review trace markers changed');
        return code.replace(initialMarker, `
          console.log('R1_POOL_TRACE', JSON.stringify({
            phase: 'owner-initial', at: Date.now(),
            selectedIsSuiteFixture: cleanup.profileIds.includes(body1.listenerId),
            selectedId: body1.listenerId,
          }));
          ${initialMarker}
        `).replace(rematchMarker, `
          const traceBody = await res3.clone().json();
          const traceState = await getFullState(requestId, body1.listenerId);
          console.log('R1_POOL_TRACE', JSON.stringify({
            phase: 'owner-rematch', at: Date.now(), status: res3.status,
            body: traceBody, requestState: traceState.request?.state,
            reservations: traceState.reservations.map(r => ({ id: r.id, state: r.state })),
            originalListenerExists: traceState.presence !== null,
          }));
          ${rematchMarker}
        `);
      }
      if (normalized === `${tests}matching-coordinator.test.ts`) {
        const marker = "await admin.from('listener_profiles').delete().in('id', cleanupIds.profileIds);";
        if (!code.includes(marker)) throw new Error('Coordinator cleanup trace marker changed');
        return code.replace(marker, `
          console.log('R1_POOL_TRACE', JSON.stringify({ phase: 'coordinator-cleanup', at: Date.now(), profileIds: cleanupIds.profileIds }));
          ${marker}
        `);
      }
    },
  }],
  test: {
    ...baseline.test,
    include: [`${tests}matching-authorization.test.ts`, `${tests}matching-coordinator.test.ts`],
    maxWorkers: 2,
    minWorkers: 1,
  },
};
