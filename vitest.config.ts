import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    globals: true,
    include: [
      "tests/unit/**/*.test.{ts,tsx,js}",
      "tests/integration/**/*.test.{ts,tsx,js}",
    ],
    exclude: ["tests/e2e/**", "node_modules/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/**/*.{ts,tsx}", "public/scripts/**/*.js"],
      exclude: [
        "src/**/*.d.ts",
        "src/app/layout.tsx",
        "src/app/**/page.tsx",
        "node_modules/**",
      ],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@validator-shared": path.resolve(
        __dirname,
        "./src/lib/validator/shared"
      ),
      "@validator-opportunities": path.resolve(
        __dirname,
        "./src/lib/validator/opportunities"
      ),
    },
  },
});
