import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// UI C — Trip Board. Dev on 5175 so all three apps can run together.
export default defineConfig({
  plugins: [react()],
  server: { port: 5175 },
  preview: { port: 5175 },
});
