import { fileURLToPath } from 'node:url';
import baseline from '../2026-09-06-glm-long-horizon-review/adversarial.config.mjs';

// Review-only mutation test: deliberately suppress rematching AFTER the real
// expiry transaction. Production files on disk and test assertions are unchanged.
const testFile = fileURLToPath(new URL('../../../apps/web/tests/matching-authorization.test.ts', import.meta.url)).replaceAll('\\', '/');
export default {
  ...baseline,
  plugins: [{
    name: 'review-rematch-assertion-sensitivity',
    enforce: 'pre',
    transform(code, id) {
      if (!id.replaceAll('\\', '/').split('?')[0].endsWith('/apps/web/src/features/matching/coordinator.ts')) return;
      const marker = 'return this.attemptMatch(requestId, opts);';
      if (code.split(marker).length !== 2) throw new Error('Expected exactly one lazy-rematch branch');
      return code.replace(marker, `
        console.log('R1_REMATCH_SENSITIVITY', 'Injected early no_candidates after real expiry; rematching suppressed');
        return { status: 'no_candidates', requestId, message: 'Review-injected suppressed rematch' };
      `);
    },
  }],
  test: { ...baseline.test, include: [testFile] },
};
