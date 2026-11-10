import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import ts from 'typescript-eslint';
import svelteConfig from './svelte.config.js';

export default ts.config(
  {
    ignores: [
      'out/',
      'dist/',
      'dist-npm/',
      'node_modules/',
      'docs/mockups/',
      'coverage/',
      'android/',
    ],
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  ...svelte.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    files: ['**/*.svelte', '**/*.svelte.ts'],
    languageOptions: {
      parserOptions: {
        projectService: false,
        extraFileExtensions: ['.svelte'],
        parser: ts.parser,
        svelteConfig,
      },
    },
  },
  {
    // Layer rule (AGENTS.md): core is pure logic without Electron or Node imports.
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { regex: '^node:', message: 'src/core darf keine Node-Module importieren.' },
            { regex: '^electron', message: 'src/core darf Electron nicht importieren.' },
            {
              regex:
                '^(fs|path|os|net|child_process|crypto|events|stream|http|https|url|util|worker_threads|timers)(/.*)?$',
              message: 'src/core darf keine Node-Module importieren.',
            },
            { regex: '^\\.\\./', message: 'src/core darf nur aus src/core importieren.' },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'process', message: 'Kein process in src/core.' },
        { name: 'setTimeout', message: 'Zeit nur über den Clock-Port.' },
        { name: 'setInterval', message: 'Zeit nur über den Clock-Port.' },
      ],
    },
  },
  {
    // Renderer runs sandboxed: no Node or Electron imports.
    files: ['src/renderer/**/*.ts', 'src/renderer/**/*.svelte'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [{ regex: '^(node:|electron)', message: 'Renderer läuft ohne Node-Zugriff.' }],
        },
      ],
    },
  },
);
