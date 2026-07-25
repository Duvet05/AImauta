import { describe, expect, it } from "vitest";

import { isStrictlyEnabled } from "@/lib/feature-flags";

describe("banderas de funcionalidad", () => {
  it("habilita únicamente el valor exacto true", () => {
    expect(isStrictlyEnabled("true")).toBe(true);
  });

  it.each([undefined, "", "false", "TRUE", " true ", "1", "yes"])(
    "falla cerrado para %s",
    (value) => {
      expect(isStrictlyEnabled(value)).toBe(false);
    },
  );
});
