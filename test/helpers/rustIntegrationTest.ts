import { describe } from "vitest";

/** Vitest subprocess cargo tests are for local dev; CI runs `cargo test` separately. */
export const describeRustIntegration = process.env.CI ? describe.skip : describe;
