import { describe, expect, it } from "vitest";

import { parseByteRange } from "@/lib/ranges";

describe("parseByteRange", () => {
  it("interpreta un rango abierto", () => {
    expect(parseByteRange("bytes=100-", 1_000)).toEqual({
      start: 100,
      end: 999
    });
  });

  it("interpreta un sufijo", () => {
    expect(parseByteRange("bytes=-100", 1_000)).toEqual({
      start: 900,
      end: 999
    });
  });

  it("limita el final al tamaño del archivo", () => {
    expect(parseByteRange("bytes=900-1200", 1_000)).toEqual({
      start: 900,
      end: 999
    });
  });

  it("rechaza rangos múltiples o fuera del archivo", () => {
    expect(() => parseByteRange("bytes=0-1,4-5", 1_000)).toThrow(RangeError);
    expect(() => parseByteRange("bytes=1000-", 1_000)).toThrow(RangeError);
  });
});
