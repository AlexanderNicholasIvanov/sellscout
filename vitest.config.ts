import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: [
      {
        test: {
          name: 'server',
          environment: 'node',
          include: ['tests/**/*.test.ts'],
          exclude: ['e2e/**', 'node_modules/**'],
          setupFiles: ['tests/setup/no-network.ts'],
        },
      },
      {
        plugins: [react()],
        test: {
          name: 'ui',
          environment: 'jsdom',
          include: ['src/**/*.test.tsx'],
          exclude: ['e2e/**', 'node_modules/**'],
          // globals lets @testing-library/react clean up the DOM after each test.
          globals: true,
          setupFiles: ['@testing-library/jest-dom/vitest'],
        },
      },
    ],
  },
});
