import { defineConfig } from 'vitest/config';
import { config } from 'dotenv';

config();

// The eval fires dozens of multi-step calls; pace them under the free-tier cap.
process.env.LLM_MIN_INTERVAL_MS ||= '3300';

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
