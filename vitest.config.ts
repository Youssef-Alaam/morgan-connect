import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['cobertura', 'text-summary'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
    },
    projects: [
      {
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts', 'test/unit/**/*.test.ts'],
        },
      },
      { test: { name: 'integration', include: ['test/integration/**/*.test.ts'] } },
      { test: { name: 'perf', include: ['test/perf/**/*.test.ts'] } },
    ],
  },
});
