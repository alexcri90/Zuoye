import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { securityHeaders, serviceWorker, vendoredData } from './build/plugins.ts';

export default defineConfig({
  // Relative base: the same build works at the domain root and under /Zuoye/ on GitHub Pages.
  base: './',
  plugins: [react(), vendoredData(), securityHeaders(), serviceWorker()],
  build: {
    target: 'es2022',
    sourcemap: false,
  },
  server: {
    host: false,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
