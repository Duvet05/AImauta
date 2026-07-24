import { describe, expect, it } from "vitest";

import { getBookUnits, getPageActivity } from "@/lib/curriculum";

const bookId = "fichas-matematica-1-secundaria";

describe("currículo por página", () => {
  it("modela las ocho fichas del libro", () => {
    expect(getBookUnits(bookId)).toHaveLength(8);
  });

  it.each([
    [13, "learn", "ficha-1-fracciones"],
    [17, "practice", "ficha-1-fracciones"],
    [21, "assessment", "ficha-1-fracciones"],
    [65, "learn", "ficha-6-inecuaciones"],
    [95, "assessment", "ficha-8-probabilidad"]
  ])("clasifica página %i como %s", (page, stage, unitId) => {
    expect(getPageActivity(bookId, page)).toMatchObject({
      stage,
      unitId
    });
  });

  it("bloquea el tutor durante Evaluamos", () => {
    expect(getPageActivity(bookId, 52).tutorAvailable).toBe(false);
    expect(getPageActivity(bookId, 49).tutorAvailable).toBe(true);
  });
});
