import * as path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      vscode: path.resolve(__dirname, 'tests/mocks/vscode.ts')
    }
  },
  test: {
    globals: false,
    include: [
      'tests/functional/**/*.test.ts',
      'tests/services/**/*.test.ts'
    ]
  }
});
