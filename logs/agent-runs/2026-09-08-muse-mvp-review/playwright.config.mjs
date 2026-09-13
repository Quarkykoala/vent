import { fileURLToPath } from 'node:url';
export default {
  testDir: fileURLToPath(new URL('../../../apps/web/e2e/', import.meta.url)),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:3108', browserName: 'chromium', trace: 'off' },
  outputDir: fileURLToPath(new URL('./playwright-results/', import.meta.url)),
};
