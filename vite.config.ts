import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  // Relative paths, so the built site works from any folder (GitHub Pages serves it from /openxp-routes/).
  base: "./",
  test: { include: ["src/**/*.test.ts"] },
});
