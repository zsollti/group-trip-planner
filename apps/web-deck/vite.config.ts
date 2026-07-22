import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// UI A — Command Deck. Dev on 5173 so all three apps can run together.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  preview: { port: 5173 },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
  },
});
