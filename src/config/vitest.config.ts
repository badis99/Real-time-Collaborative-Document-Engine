import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Run integration tests sequentially — they share a real DB
    // Running them in parallel causes state to bleed between tests
    pool:        "forks",
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 10_000,   // socket tests can be slow
  },
});