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

  it("detrás del edge confía solo en un X-Forwarded-For canónico", () => {
    process.env.AIMAUTA_TRUST_PROXY_HEADERS = "true";
    const canonical = requestRateLimitKey(
      new Request("http://aimauta.test", {
        headers: {
          "X-Forwarded-For": "203.0.113.41",
          "CF-Connecting-IP": "198.51.100.1",
          "X-Real-IP": "198.51.100.2"
        }
      })
    );
    const spoofedAuxiliaryHeaders = requestRateLimitKey(
      new Request("http://aimauta.test", {
        headers: {
          "X-Forwarded-For": "203.0.113.41",
          "CF-Connecting-IP": "192.0.2.1",
          "X-Real-IP": "192.0.2.2"
        }
      })
    );
    const anotherClient = requestRateLimitKey(
      new Request("http://aimauta.test", {
        headers: { "X-Forwarded-For": "2001:db8::41" }
      })
    );

    expect(canonical).toBe(spoofedAuxiliaryHeaders);
    expect(canonical).not.toBe(anotherClient);
  });

  it("rechaza cadenas X-Forwarded-For y direcciones inválidas", () => {
    process.env.AIMAUTA_TRUST_PROXY_HEADERS = "true";
    const chained = requestRateLimitKey(
      new Request("http://aimauta.test", {
        headers: { "X-Forwarded-For": "203.0.113.41, 198.51.100.8" }
      })
    );
    const invalid = requestRateLimitKey(
      new Request("http://aimauta.test", {
        headers: {
          "X-Forwarded-For": "not-an-ip",
          "CF-Connecting-IP": "203.0.113.41",
          "X-Real-IP": "203.0.113.41"
        }
      })
    );

    expect(chained).toBe(invalid);
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
