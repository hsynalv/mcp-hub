import { FlatCompat } from "@eslint/eslintrc";
import path from "path";
import { fileURLToPath } from "url";
import js from "@eslint/js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
});

export default [
  {
    ignores: ["node_modules/", "cache/", "dist/", "*.log", "src/public/"],
  },
  ...compat.extends("eslint:recommended", "prettier"),
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        // Node.js
        console: "readonly",
        process: "readonly",
        Buffer: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        global: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        // Node.js 18+ globals
        fetch: "readonly",
        FormData: "readonly",
        URLSearchParams: "readonly",
        Headers: "readonly",
        Request: "readonly",
        Response: "readonly",
        AbortSignal: "readonly",
        crypto: "readonly",
        // Testing globals
        describe: "readonly",
        it: "readonly",
        expect: "readonly",
        beforeAll: "readonly",
        afterAll: "readonly",
        beforeEach: "readonly",
        afterEach: "readonly",
        jest: "readonly",
      },
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_,^", varsIgnorePattern: "^_,^" }],
      "no-console": "off",
      "no-undef": "error",
      "prefer-const": "warn",
      "no-var": "error",
      "no-useless-escape": "warn",
      "no-case-declarations": "off",
    },
  },
  // Shell plugin - allow require for dynamic imports
  {
    files: ["src/plugins/shell/index.js"],
    rules: {
      "no-undef": "off",
    },
  },
];
