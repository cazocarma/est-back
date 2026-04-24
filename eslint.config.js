// Flat config para ESLint 9+ (el legacy .eslintrc dejó de soportarse).
// Cubre TypeScript del backend (src/**/*.ts). No corre sobre dist ni tests.
import js from '@eslint/js';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import globals from 'globals';

export default [
  {
    ignores: ['node_modules/**', 'dist/**', 'coverage/**', '*.config.js', '*.config.cjs'],
  },

  js.configs.recommended,

  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,

      // Permitir args prefijados con _ (convención común para ignorados).
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],

      // any queda como warn para no trabar builds; forzar a error si se quiere más estricto.
      '@typescript-eslint/no-explicit-any': 'warn',

      // console.log es ruido en prod; warn/error están bien para logs de error.
      'no-console': ['warn', { allow: ['warn', 'error'] }],

      // Igualdad estricta siempre.
      eqeqeq: ['error', 'always'],

      // var prohibido (usar let/const).
      'no-var': 'error',

      // const cuando no hay reasignación.
      'prefer-const': 'warn',

      // Las reglas del core que chocan con TS quedan off — el plugin las cubre.
      'no-unused-vars': 'off',
      'no-undef': 'off',
    },
  },

  {
    files: ['src/**/*.test.ts', 'src/**/*.spec.ts'],
    languageOptions: {
      globals: {
        ...globals.node,
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        beforeAll: 'readonly',
        beforeEach: 'readonly',
        afterAll: 'readonly',
        afterEach: 'readonly',
        vi: 'readonly',
      },
    },
    rules: {
      // Los tests son más flexibles: permitir any y console.
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
    },
  },
];
