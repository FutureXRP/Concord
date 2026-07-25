import { describe, expect, it } from "vitest";
import { PROXY_CACHE_TTL_MS } from "../lib/youversion/proxy";

describe("YouVersion proxy invariants (spec 3.2)", () => {
  it("declares an explicit, bounded TTL for the request-scoped cache", () => {
    // "Set an explicit TTL and assert it in tests."
    expect(PROXY_CACHE_TTL_MS).toBeGreaterThan(0);
    expect(PROXY_CACHE_TTL_MS).toBeLessThanOrEqual(5 * 60_000);
  });
});
