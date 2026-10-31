import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import prettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

const forbid = (name, patterns, message) => ({
  "no-restricted-imports": ["error", { patterns: [{ group: patterns, message: `${name}: ${message}` }] }]
});

const SDKS = ["@google/genai", "@napi-rs/keyring", "@inquirer/*", "chalk", "ora", "commander"];

export default defineConfig(
  { ignores: ["dist/**", "node_modules/**", "templates/**", "coverage/**"] },
  js.configs.recommended,
  tseslint.configs.recommended,
  prettier,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      eqeqeq: "error",
      "no-console": "error"
    }
  },
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: { globals: { URL: "readonly", process: "readonly", console: "readonly" } },
    rules: { "no-console": "off" }
  },
  // Layering: dependencies point inward (see docs/architecture.md).
  {
    files: ["src/shared/**/*.ts"],
    rules: forbid(
      "shared",
      ["**/domain/**", "**/application/**", "**/infrastructure/**", "**/presentation/**"],
      "shared code must not depend on other layers."
    )
  },
  {
    files: ["src/domain/**/*.ts"],
    rules: forbid(
      "domain",
      ["**/application/**", "**/infrastructure/**", "**/presentation/**", ...SDKS, "node:fs", "node:fs/promises"],
      "the domain layer is pure."
    )
  },
  {
    files: ["src/application/**/*.ts"],
    rules: forbid(
      "application",
      ["**/infrastructure/**", "**/presentation/**", ...SDKS, "node:fs", "node:fs/promises", "node:child_process"],
      "use ports instead of concrete implementations."
    )
  },
  {
    files: ["src/presentation/**/*.ts"],
    rules: forbid(
      "presentation",
      ["**/infrastructure/**", "@google/genai", "@napi-rs/keyring"],
      "talk to infrastructure through use cases."
    )
  },
  {
    files: ["src/infrastructure/**/*.ts"],
    rules: forbid("infrastructure", ["**/presentation/**"], "infrastructure must not know about the UI.")
  },
  // Only the Gemini adapter may import the Gemini SDK.
  {
    files: ["src/infrastructure/**/*.ts"],
    ignores: ["src/infrastructure/providers/gemini/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [{ group: ["**/presentation/**"], message: "infrastructure must not know about the UI." }],
          paths: [{ name: "@google/genai", message: "Provider SDKs stay inside their adapter folder." }]
        }
      ]
    }
  }
);
