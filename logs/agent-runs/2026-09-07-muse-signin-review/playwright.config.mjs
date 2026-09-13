import { fileURLToPath } from 'node:url';

// Review runner only. Executes Muse's existing tests against the isolated local server.
export default {
  testDir: fileURLToPath(new URL('../../../apps/web/e2e/', import.meta.url)),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:3107', browserName: 'chromium', trace: 'off' },
  outputDir: fileURLToPath(new URL('./playwright-results/', import.meta.url)),
};
