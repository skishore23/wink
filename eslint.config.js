const js = require('@eslint/js');
const tsPlugin = require('@typescript-eslint/eslint-plugin');
const tsParser = require('@typescript-eslint/parser');

module.exports = [
  {
    ignores: ['src/tests/**', 'src/commands/**']
  },
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: './tsconfig.json',
        ecmaVersion: 2020,
        sourceType: 'module'
      },
      globals: {
        // Node.js globals
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        require: 'readonly',
        module: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly'
      }
    },
    plugins: {
      '@typescript-eslint': tsPlugin
    },
    rules: {
      // Include recommended rules
      ...js.configs.recommended.rules,
      ...tsPlugin.configs.recommended.rules,

      // Type Safety (warnings for gradual adoption)
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',

      // Code Quality
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-misused-promises': 'warn',
      '@typescript-eslint/await-thenable': 'warn',
      '@typescript-eslint/require-await': 'off',

      // Best Practices
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_'
      }],
      '@typescript-eslint/no-non-null-assertion': 'warn',
      '@typescript-eslint/strict-boolean-expressions': 'off',

      // Consistency - relaxed naming
      '@typescript-eslint/naming-convention': 'off',
      '@typescript-eslint/member-ordering': 'off',
      '@typescript-eslint/no-extraneous-class': 'off',

      // Security & Safety
      'no-eval': 'error',
      'no-implied-eval': 'error',
      '@typescript-eslint/no-dynamic-delete': 'warn',
      '@typescript-eslint/prefer-readonly': 'off',

      // Modern JavaScript
      'prefer-const': 'error',
      'prefer-arrow-callback': 'warn',
      'prefer-template': 'off',
      'no-var': 'error',

      // Common Mistakes
      'no-console': 'off',
      'eqeqeq': ['error', 'always'],
      'no-throw-literal': 'warn',
      '@typescript-eslint/no-unnecessary-condition': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'warn'
    }
  }
];