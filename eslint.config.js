import eslint from '@eslint/js';
import comments from '@eslint-community/eslint-plugin-eslint-comments/configs';
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

export default tseslint.config(
  { ignores: ['node_modules/**', 'coverage/**', 'dist/**', '.claude/**'] },
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
    },
  },
  {
    files: ['src/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: { 'no-restricted-syntax': ['error', jsonParseCast, bodyCast, ...topLevelLet] },
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
    files: ['**/*.{js,cjs,mjs}'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: { module: 'readonly' } },
  },
);
