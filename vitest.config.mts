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
    include: ['test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 120_000,
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      exclude: ['src/generated/**', 'src/main.ts', 'src/worker.ts'],
    },
  },
});
