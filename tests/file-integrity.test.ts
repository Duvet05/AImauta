import { createHash } from "node:crypto";
import {
  mkdtemp,
  open,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { verifyOpenedPinnedFile } from "@/lib/file-integrity";

const createdDirectories: string[] = [];

async function temporaryFile(contents: string): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "aimauta-integrity-"));
  createdDirectories.push(directory);
  const filePath = path.join(directory, "material.pdf");
  await writeFile(filePath, contents);
  return filePath;
}

async function verifyFile(
  filePath: string,
  expectedBytes: number,
  expectedSha256: string
): Promise<boolean> {
  const handle = await open(filePath, "r");
  try {
    return await verifyOpenedPinnedFile(
      filePath,
      handle,
      expectedBytes,
      expectedSha256
    );
  } finally {
    await handle.close();
  }
}

afterEach(async () => {
  await Promise.all(
    createdDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe("integridad del contenido local", () => {
  it("acepta únicamente el tamaño y SHA-256 fijados", async () => {
    const contents = "%PDF-material-aprobado";
    const filePath = await temporaryFile(contents);
    const digest = createHash("sha256").update(contents).digest("hex");

    await expect(
      verifyFile(filePath, Buffer.byteLength(contents), digest)
    ).resolves.toBe(true);
    await expect(
      verifyFile(filePath, Buffer.byteLength(contents), "0".repeat(64))
    ).resolves.toBe(false);
  });

  it("invalida la caché si el archivo cambia sin cambiar de tamaño", async () => {
    const original = "%PDF-material-original";
    const replacement = "%PDF-material-alterado";
    expect(Buffer.byteLength(replacement)).toBe(Buffer.byteLength(original));
    const filePath = await temporaryFile(original);
    const digest = createHash("sha256").update(original).digest("hex");

    await expect(
      verifyFile(filePath, Buffer.byteLength(original), digest)
    ).resolves.toBe(true);
    await writeFile(filePath, replacement);
    await expect(
      verifyFile(filePath, Buffer.byteLength(original), digest)
    ).resolves.toBe(false);
  });

  it("mantiene ligado el contenido al descriptor que verificó", async () => {
    const original = "%PDF-edicion-original";
    const replacement = "%PDF-edicion-alterada";
    expect(Buffer.byteLength(replacement)).toBe(Buffer.byteLength(original));
    const filePath = await temporaryFile(original);
    const replacementPath = `${filePath}.replacement`;
    await writeFile(replacementPath, replacement);
    const digest = createHash("sha256").update(original).digest("hex");
    const handle = await open(filePath, "r");

    try {
      await expect(
        verifyOpenedPinnedFile(
          filePath,
          handle,
          Buffer.byteLength(original),
          digest
        )
      ).resolves.toBe(true);
      await rename(replacementPath, filePath);

      const chunks: Buffer[] = [];
      for await (const chunk of handle.createReadStream({
        start: 0,
        autoClose: false
      })) {
        chunks.push(chunk as Buffer);
      }
      expect(Buffer.concat(chunks).toString()).toBe(original);
    } finally {
      await handle.close();
    }

    await expect(
      verifyFile(filePath, Buffer.byteLength(original), digest)
    ).resolves.toBe(false);
  });
});
