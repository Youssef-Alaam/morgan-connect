import eslint from '@eslint/js';
import comments from '@eslint-community/eslint-plugin-eslint-comments/configs';
import i18next from 'eslint-plugin-i18next';
import tseslint from 'typescript-eslint';

const jsonParseCast = {
  selector:
    "TSAsExpression > CallExpression[callee.object.name='JSON'][callee.property.name='parse']",
  message: 'Parse outside data with a schema, not an `as` cast.',
};
const bodyCast = {
  selector: "TSAsExpression > MemberExpression[property.name='body']",
  message: 'Parse request bodies with a schema, not an `as` cast.',
};
const noDynamicImport = {
  selector: 'ImportExpression',
  message: 'No dynamic import() in src/: code must be reachable by static imports only.',
};
const topLevelLet = [
  "Program > VariableDeclaration[kind='let']",
  "ExportNamedDeclaration > VariableDeclaration[kind='let']",
].map((selector) => ({
  selector,
  message: 'No module-level mutable state in src/: app code must be stateless.',
}));
const mockOwnModule = {
  selector:
    "CallExpression[callee.object.name='vi'][callee.property.name=/^(mock|doMock)$/]:matches([arguments.0.value=/^(\\.|@\\/)/], [arguments.0.type='ImportExpression'][arguments.0.source.value=/^(\\.|@\\/)/])",
  message: 'Do not mock the project own modules; mock only at the edges.',
};

const mockPg = {
  selector:
    "CallExpression[callee.object.name='vi'][callee.property.name=/^(mock|doMock)$/][arguments.0.value=/^pg(\\/.*)?$/]",
  message: 'Integration tests use a real Postgres, never a mocked pg.',
};

const rawWrites = [
  'writeFile',
  'writeFileSync',
  'appendFile',
  'appendFileSync',
  'createWriteStream',
];
const rawWriteMessage =
  'Write files with atomicWrite from src/ops/atomic-write.ts (temp, then rename).';

// Raw colour, length and font values belong in web/src/tokens.ts (unanchored, so "1px solid #fff" fails).
const rawPattern = '#[0-9a-fA-F]{3,8}|(rgb|hsl)a?[(]|[0-9](px|rem|em|%|vh|vw)|font-family';
const rawValues = ['Literal[value', 'TemplateElement[value.raw'].map((selector) => ({
  selector: `${selector}=/${rawPattern}/]`,
  message: 'Raw colour, spacing and font values live in web/src/tokens.ts only.',
}));

export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      'coverage/**',
      'dist/**',
      'dist-evals/**',
      'web/dist/**',
      '.claude/**',
    ],
  },
  eslint.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  comments.recommended,
  {
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@eslint-community/eslint-comments/require-description': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/only-throw-error': 'error',
      '@typescript-eslint/ban-ts-comment': [
        'error',
        { 'ts-expect-error': 'allow-with-description', 'ts-ignore': true },
      ],
      '@typescript-eslint/switch-exhaustiveness-check': [
        'error',
        { considerDefaultExhaustiveForUnions: false },
      ],
      '@typescript-eslint/strict-boolean-expressions': 'error',
      eqeqeq: 'error',
      'no-implicit-coercion': 'error',
      'no-console': 'error',
      'no-empty': 'error',
      'max-lines': ['error', { max: 300, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': ['error', { max: 50, skipBlankLines: true, skipComments: true }],
      complexity: ['error', 10],
      'max-params': ['error', 4],
      'max-depth': ['error', 3],
      'max-nested-callbacks': ['error', 3],
      'no-restricted-syntax': ['error', jsonParseCast, bodyCast],
      'no-restricted-imports': [
        'error',
        {
          paths: ['fs', 'node:fs', 'fs/promises', 'node:fs/promises'].map((name) => ({
            name,
            importNames: rawWrites,
            message: rawWriteMessage,
          })),
        },
      ],
      'no-restricted-properties': [
        'error',
        ...rawWrites.map((property) => ({ property, message: rawWriteMessage })),
      ],
    },
  },
  {
    files: ['src/ops/atomic-write.ts'],
    rules: { 'no-restricted-imports': 'off', 'no-restricted-properties': 'off' },
  },
  {
    files: ['src/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-syntax': ['error', jsonParseCast, bodyCast, noDynamicImport, ...topLevelLet],
    },
  },
  {
    files: ['**/*.test.ts'],
    rules: {
      'max-lines': ['error', { max: 500, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': 'off',
      'no-restricted-syntax': ['error', jsonParseCast, bodyCast, mockOwnModule, mockPg],
    },
  },
  {
    files: ['web/src/**/*.{ts,tsx}'],
    ignores: ['web/src/tokens.ts', '**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': ['error', ...rawValues],
    },
  },
  {
    files: ['web/src/**/*.tsx'],
    ignores: ['**/*.test.{ts,tsx}'],
    extends: [i18next.configs['flat/recommended']],
    rules: { 'i18next/no-literal-string': ['error', { mode: 'jsx-only' }] },
  },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: { process: 'readonly', console: 'readonly' } },
    rules: { 'no-console': 'off' },
  },
  {
    files: ['**/*.{js,cjs,mjs}'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: { module: 'readonly' } },
  },
);
