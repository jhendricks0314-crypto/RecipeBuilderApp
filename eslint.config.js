// Catches the bug class that `node --check` cannot: identifiers that are used
// but never declared or imported. Two runtime crashes in this project came from
// exactly that (a missing import, and a constant whose definition was dropped
// during an edit), and both passed a syntax check cleanly.
import globals from 'globals'

export default [
  {
    files: ['netlify/**/*.js', 'scripts/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node, fetch: 'readonly', Response: 'readonly', Request: 'readonly' },
    },
    rules: { 'no-undef': 'error' },
  },
  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser },
    },
    rules: { 'no-undef': 'error' },
  },
]
