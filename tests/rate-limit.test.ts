import { describe, expect, it, vi } from "vitest";

import {
  consumeRateLimit,
  RateLimitError,
  requestRateLimitKey
} from "@/lib/rate-limit";

describe("límites de admisión", () => {
  it("rechaza solicitudes por encima de la ventana y permite continuar al vencer", () => {
    const key = crypto.randomUUID();

    expect(
      consumeRateLimit({
        scope: "test",
        key,
        limit: 2,
        windowMs: 1_000,
        now: 10_000
      })
    ).toMatchObject({ remaining: 1, resetAt: 11_000 });
    expect(
      consumeRateLimit({
        scope: "test",
        key,
        limit: 2,
        windowMs: 1_000,
        now: 10_100
      })
    ).toMatchObject({ remaining: 0 });
    expect(() =>
      consumeRateLimit({
        scope: "test",
        key,
        limit: 2,
        windowMs: 1_000,
        now: 10_200
      })
    ).toThrow(RateLimitError);
    expect(
      consumeRateLimit({
        scope: "test",
        key,
        limit: 2,
        windowMs: 1_000,
        now: 11_001
      })
    ).toMatchObject({ remaining: 1 });
  });

  it("sin proxy confiable usa un bucket compartido no evadible por User-Agent", () => {
    delete process.env.AIMAUTA_TRUST_PROXY_HEADERS;
    const first = requestRateLimitKey(
      new Request("http://aimauta.test", {
        headers: { "User-Agent": "browser-a" }
      })
    );
    const second = requestRateLimitKey(
      new Request("http://aimauta.test", {
        headers: { "User-Agent": "browser-b" }
      })
    );

    expect(first).toBe(second);
  });

  it("comparte los buckets entre evaluaciones aisladas del módulo", async () => {
    const scope = `bundle-test-${crypto.randomUUID()}`;
    const key = crypto.randomUUID();

    vi.resetModules();
    const firstBundle = await import("@/lib/rate-limit");
    firstBundle.consumeRateLimit({
      scope,
      key,
      limit: 1,
      windowMs: 60_000,
      now: 10_000
    });

    vi.resetModules();
    const secondBundle = await import("@/lib/rate-limit");
    expect(() =>
      secondBundle.consumeRateLimit({
        scope,
        key,
        limit: 1,
        windowMs: 60_000,
        now: 10_001
      })
    ).toThrow(/Demasiadas solicitudes/);
  });
});
