import {defineConfig, globalIgnores} from 'eslint/config';
import js from '@eslint/js';
import ts from 'typescript-eslint';
import hooks from 'eslint-plugin-react-hooks';
export default defineConfig([
  js.configs.recommended, ...ts.configs.recommended,
  {files:['**/*.{ts,tsx}'],plugins:{'react-hooks':hooks},rules:{'react-hooks/rules-of-hooks':'error','react-hooks/exhaustive-deps':'error'}},
  globalIgnores(['.next/**', 'out/**', 'next-env.d.ts']),
]);
