import { promises as fs } from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();
const manifestPath = path.join(projectRoot, "config", "catalog.v3.json");
const staticDirectory = path.join(projectRoot, ".next", "static");

async function filesBelow(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await filesBelow(entryPath)));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }

  return files;
}

const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
if (
  manifest?.schemaVersion !== 3 ||
  !Array.isArray(manifest.entries)
) {
  throw new Error("No se puede auditar un catálogo inválido.");
}

const privateEntries = manifest.entries
  .filter((entry) => entry?.status !== "published")
  .filter((entry) => typeof entry?.id === "string" && entry.id.length > 0);
const privateMarkers = privateEntries.flatMap((entry) =>
  [
    "id",
    "sourcePageUrl",
    "sourcePdfUrl",
    "storageFile",
    "expectedSha256",
    "licenseEvidenceUrl",
  ].flatMap((field) => {
    const value = entry[field];
    return typeof value === "string" && value.length > 0
      ? [{ id: entry.id, field, value }]
      : [];
  }),
);

const staticFiles = await filesBelow(staticDirectory);
const leaks = [];
for (const file of staticFiles) {
  const contents = await fs.readFile(file);
  for (const marker of privateMarkers) {
    if (contents.includes(Buffer.from(marker.value))) {
      leaks.push(
        `${path.relative(projectRoot, file)} contiene ` +
          `${marker.id}.${marker.field}`,
      );
    }
  }
}

if (leaks.length > 0) {
  throw new Error(
    "El bundle cliente expone entradas no publicadas:\n" +
      leaks.map((leak) => `- ${leak}`).join("\n"),
  );
}

process.stdout.write(
  `✓ Bundle cliente sin ${privateEntries.length} entradas privadas del catálogo.\n`,
);
