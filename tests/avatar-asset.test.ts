import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const avatarPath = join(
  process.cwd(),
  "public",
  "avatars",
  "aimauta-teacher-v1.glb",
);

describe("versioned avatar asset", () => {
  it("keeps the reviewed GLB pinned by size and checksum", async () => {
    const [contents, metadata] = await Promise.all([
      readFile(avatarPath),
      stat(avatarPath),
    ]);

    expect(metadata.size).toBe(2_799_832);
    expect(createHash("sha256").update(contents).digest("hex")).toBe(
      "f732f48f6206e2c87f66fa7909302c74de791b83f9e838e32e0ac6f0d9ede957",
    );
  });
});
