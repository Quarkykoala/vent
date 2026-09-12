import { fileURLToPath } from 'node:url';

const webRoot = fileURLToPath(new URL('../../../apps/web/', import.meta.url));
const testPath = fileURLToPath(new URL('./edge-probes.test.ts', import.meta.url)).replaceAll('\\', '/');

export default {
  root: webRoot,
  resolve: { alias: {
    '@': `${webRoot}src`,
    'vitest': `${webRoot}node_modules/vitest/dist/index.js`,
    'next/server': `${webRoot}node_modules/next/server.js`,
    '@vent/db': `${webRoot}../../packages/db/src/index.ts`,
  } },
  test: {
    include: [testPath],
    maxWorkers: 2,
    minWorkers: 1,
  },
};
