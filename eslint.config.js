// ESLint flat config for the extension sources. Prettier handles formatting.
import js from "@eslint/js";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

// Inherited from NexTile: a discarded .connect() id is a handler disable() cannot drop.
const localRules = {
  "no-untracked-connect": require("./eslint-rules/no-untracked-connect.cjs"),
};

// Truly ambient globals under gnome-shell. GI namespaces are imported via gi://,
// so they are NOT listed: a missing import must fail no-undef.
const extensionGlobals = {
  globalThis: "readonly",
  global: "readonly",
  console: "readonly",
  log: "readonly",
  logError: "readonly",
  setTimeout: "readonly",
  clearTimeout: "readonly",
  TextDecoder: "readonly",
  TextEncoder: "readonly",
};

export default [
  {
    files: ["lib/**/*.js", "extension.js", "prefs.js"],
    languageOptions: { ecmaVersion: 2022, sourceType: "module", globals: extensionGlobals },
    plugins: { local: { rules: localRules } },
    rules: {
      ...js.configs.recommended.rules,
      "no-unused-vars": ["error", { caughtErrors: "none", args: "none", varsIgnorePattern: "^_" }],
      "no-unused-expressions": ["error", { allowShortCircuit: true, allowTernary: true }],
      "local/no-untracked-connect": "error",
    },
  },
  {
    // Vendored Open Bar code: its dead initial stores ("let x = []" then always
    // reassigned) are left as upstream wrote them rather than risk changing a path
    // that does read the initial value. Every other rule applies.
    files: ["lib/bar/**/*.js"],
    rules: { "no-useless-assignment": "off" },
  },
  {
    // The prefs process is torn down wholesale when its window closes.
    files: ["prefs.js", "lib/prefs/**/*.js", "lib/bar/prefs.js"],
    rules: { "local/no-untracked-connect": "off" },
  },
];
