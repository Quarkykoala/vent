import { fileURLToPath } from 'node:url';
const repo = fileURLToPath(new URL('../../../', import.meta.url));
const web = `${repo}apps/web/`;
export default {
  root: web,
  resolve: { alias: {
    '@': `${web}src`,
    '@vent/db': `${repo}packages/db/src/index.ts`,
    '@vent/domain': `${repo}packages/domain/src/index.ts`,
    '@vent/validation': `${repo}packages/validation/src/index.ts`,
    'vitest': `${web}node_modules/vitest/dist/index.js`,
    'next/server': `${web}node_modules/next/server.js`,
  } },
  test: {
    include: [fileURLToPath(new URL('./recovery-probes.test.ts', import.meta.url)).replaceAll('\\', '/')],
    maxWorkers: 1,
    minWorkers: 1,
    testTimeout: 15000,
    hookTimeout: 20000,
  },
};

