import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { prisma } from "@/lib/prisma";

const CONFIG_DIR = path.join(process.cwd(), "config");

async function seedConfigSnapshots(): Promise<void> {
  const entries = await readdir(CONFIG_DIR, { withFileTypes: true });
  const jsonFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .sort();

  for (const fileName of jsonFiles) {
    const key = fileName.replace(/\.json$/, "");
    const raw = await readFile(path.join(CONFIG_DIR, fileName), "utf8");
    const data = JSON.parse(raw);

    await prisma.configSnapshot.upsert({
      where: { key },
      create: { key, data },
      update: { data },
    });

    process.stdout.write(`✓ seeded ConfigSnapshot "${key}" from ${fileName}\n`);
  }
}

seedConfigSnapshots()
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
