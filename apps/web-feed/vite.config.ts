import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// UI B — Trip Feed. Dev on 5174 so all three apps can run together.
export default defineConfig({
  plugins: [react()],
  server: { port: 5174 },
  preview: { port: 5174 },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
  },
});
