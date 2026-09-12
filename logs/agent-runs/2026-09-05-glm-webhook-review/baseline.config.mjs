import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const webRoot = fileURLToPath(new URL('../../../apps/web/', import.meta.url));
const target = `${webRoot.replaceAll('\\', '/')}src/app/api/webhooks/razorpay/route.ts`;
const original = execFileSync('git', ['show', 'd3ca22b:apps/web/src/app/api/webhooks/razorpay/route.ts'], {
  cwd: repoRoot,
  encoding: 'utf8',
});

export default {
  root: webRoot,
  resolve: { alias: { '@': `${webRoot}src` } },
  plugins: [{
    name: 'review-original-webhook-route',
    enforce: 'pre',
    load(id) {
      if (id.split('?')[0].replaceAll('\\', '/') === target) {
        return original;
      }
    },
  }],
  test: {
    include: ['tests/webhook-route-security.test.ts'],
    maxWorkers: 2,
    minWorkers: 1,
  },
};
