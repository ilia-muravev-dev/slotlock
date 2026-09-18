import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// NestJS relies on TypeScript's legacy decorators and metadata, which esbuild cannot emit;
// SWC compiles the tests instead.
export default defineConfig({
  plugins: [
    swc.vite({
      module: { type: 'es6' },
      jsc: { target: 'es2023', transform: { legacyDecorator: true, decoratorMetadata: true } },
    }),
  ],
  test: {
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      exclude: ['src/generated/**', 'src/main.ts', 'src/worker.ts'],
    },
    projects: [
      { extends: true, test: { name: 'unit', include: ['test/unit/**/*.test.ts'] } },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['test/integration/**/*.test.ts', 'test/property/**/*.test.ts'],
          globalSetup: ['test/integration/global-setup.ts'],
          testTimeout: 60_000,
          hookTimeout: 180_000,
          fileParallelism: false,
        },
      },
    ],
  },
});
