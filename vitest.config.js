import { defineConfig } from "vitest/config";

// Unit tests cover the GI-free core (engine, spring, provider models). Anything
// importing gi:// or resource:// needs a running gnome-shell and is verified by hand
// (see README "Development").
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.js"],
  },
});
