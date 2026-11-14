import { defineConfig, mergeConfig } from "vitest/config";
import { shared } from "../../vitest.shared";

// Unit tests only: what needs the editor runs under test/integration, with another runner.
export default mergeConfig(shared, defineConfig({ test: { include: ["src/**/*.test.ts"] } }));
