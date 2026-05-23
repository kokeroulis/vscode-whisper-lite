import tseslint from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';

export default [
  {
    ignores: [
      'out/**',
      'node_modules/**',
      'vendor/**',
      '.build/**'
    ]
  },
  {
    files: [
      'src/**/*.ts',
      'tests/**/*.ts',
      'vitest.config.ts'
    ],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: './tsconfig.eslint.json',
        sourceType: 'module'
      }
    },
    plugins: {
      '@typescript-eslint': tseslint
    },
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/typedef': [
        'error',
        {
          arrayDestructuring: true,
          arrowParameter: false,
          memberVariableDeclaration: true,
          parameter: true,
          propertyDeclaration: true,
          variableDeclaration: false,
          variableDeclarationIgnoreFunction: false
        }
      ]
    }
  }
];
