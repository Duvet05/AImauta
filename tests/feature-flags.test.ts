import { describe, expect, it } from "vitest";

import {
  isAvatarPreviewRequested,
  isStrictlyEnabled,
} from "@/lib/feature-flags";

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

  it("requires the exact avatar preview query value", () => {
    expect(isAvatarPreviewRequested("1")).toBe(true);
  });

  it.each([undefined, "", "true", "01", ["1"], ["1", "1"]])(
    "keeps the avatar preview closed for %s",
    (value) => {
      expect(isAvatarPreviewRequested(value)).toBe(false);
    },
  );
});
