import { promises as fs } from "node:fs";
import path from "node:path";

import nextEnv from "@next/env";

const projectRoot = process.cwd();
const standaloneRoot = path.join(projectRoot, ".next", "standalone");
const copiedEnvironmentFiles = [".env", ".env.production"];
const allowedRootEntries = new Set([
  ".next",
  "node_modules",
  "package.json",
  "server.js"
]);
const secretKeys = [
  "AIMAUTA_AGENT_SECRET",
  "AIMAUTA_ASSIGNMENT_ADMIN_SECRET",
  "AIMAUTA_ASSIGNMENT_TOKEN_SECRET",
  "AIMAUTA_SESSION_SECRET",
  "DATABASE_URL",
  "LIVEKIT_API_KEY",
  "LIVEKIT_API_SECRET",
  "OPENAI_API_KEY",
  "XAI_API_KEY"
];

async function removeCopiedEnvironmentFile(fileName) {
  const filePath = path.join(standaloneRoot, fileName);
  let metadata;
  try {
    metadata = await fs.lstat(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return;
    }
    throw error;
  }
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(
      `El artefacto standalone contiene una ruta de entorno inesperada: ${fileName}`
    );
  }
  await fs.unlink(filePath);
}

async function filesBelow(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      const target = await fs.realpath(entryPath);
      const relativeTarget = path.relative(standaloneRoot, target);
      if (
        relativeTarget === ".." ||
        relativeTarget.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relativeTarget)
      ) {
        throw new Error(
          `El artefacto standalone contiene un enlace externo: ` +
            path.relative(projectRoot, entryPath)
        );
      }
      continue;
    }
    if (entry.isDirectory()) {
      files.push(...(await filesBelow(entryPath)));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }
  return files;
}

const { combinedEnv } = nextEnv.loadEnvConfig(projectRoot, false, {
  error() {},
  info() {}
});
const secretMarkers = secretKeys.flatMap((key) => {
  const value = combinedEnv[key];
  return typeof value === "string" && value.length >= 12
    ? [{ key, value: Buffer.from(value) }]
    : [];
});

for (const fileName of copiedEnvironmentFiles) {
  await removeCopiedEnvironmentFile(fileName);
}

const rootEntries = await fs.readdir(standaloneRoot);
const unexpectedEntries = rootEntries.filter(
  (entry) => !allowedRootEntries.has(entry)
);
if (unexpectedEntries.length > 0) {
  throw new Error(
    "El standalone contiene rutas ajenas al runtime:\n" +
      unexpectedEntries.map((entry) => `- ${entry}`).join("\n")
  );
}

const leaks = [];
for (const file of await filesBelow(standaloneRoot)) {
  const contents = await fs.readFile(file);
  for (const marker of secretMarkers) {
    if (contents.includes(marker.value)) {
      leaks.push(
        `${path.relative(projectRoot, file)} contiene ${marker.key}`
      );
    }
  }
}
if (leaks.length > 0) {
  throw new Error(
    "El artefacto standalone contiene secretos de build:\n" +
      leaks.map((leak) => `- ${leak}`).join("\n")
  );
}

process.stdout.write(
  "✓ Standalone limitado al runtime y sin archivos de entorno ni secretos.\n"
);
