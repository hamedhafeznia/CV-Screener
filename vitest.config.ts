import { defineConfig } from 'vitest/config';
import { config } from 'dotenv';

config();

export default defineConfig({
  test: {
    include: ['eval/**/*.test.ts'],
    // The eval calls a rate-limited model with a multi-step tool loop; run the
    // questions in sequence so a free-tier key does not 429 its way to a red suite.
    fileParallelism: false,
    maxConcurrency: 1,
    testTimeout: 180_000,
    hookTimeout: 60_000,
    reporters: ['verbose'],
  },
});
