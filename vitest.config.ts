import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./apps/web", import.meta.url)) },
  },
  esbuild: { jsx: "automatic" },
  test: { exclude: ["**/node_modules/**", "**/.next/**", "**/temp/**"] },
});
