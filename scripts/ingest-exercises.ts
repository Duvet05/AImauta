import { randomUUID } from "node:crypto";
import {
  lstat,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { getCatalogEntries } from "@/lib/catalog";
import { ingestExercisesFromPdf } from "@/lib/exercise-ingestion";
import {
  detectExerciseWindowWithGemma,
  solveExerciseWithGemma,
} from "@/lib/gemma-ingest";
import {
  absoluteConfiguredRoot,
  assertOwnedDirectory,
  assertOwnedRegularFile,
  currentNonRootUid,
  directChildPath,
  prepareOwnedJobDirectory,
  readStableOwnedFile,
} from "@/scripts/private-runtime-paths";

const DEFAULT_MODEL = "gemma-4-26b-a4b-it";
const DEFAULT_INGEST_ROOT = "/home/hii1sc/aimauta-ingest";
const MAX_API_KEY_BYTES = 4_096;
const safeModelPattern = /^[a-z0-9][a-z0-9._-]{0,127}$/u;

type IngestLayout = {
  root: string;
  jobs: string;
  secrets: string;
  uid: number;
};

type CliOptions = {
  bookId: string;
  pdfPath: string;
  outputDir: string;
  apiKeyFile: string;
  model: string;
};

class IngestCliError extends Error {}

function optionValue(
  args: readonly string[],
  name: string,
): string | undefined {
  const positions = args
    .map((value, index) => (value === name ? index : -1))
    .filter((index) => index >= 0);
  if (positions.length !== 1) {
    return undefined;
  }
  const value = args[positions[0] + 1];
  return value && !value.startsWith("--") ? value : undefined;
}

function ingestLayout(): IngestLayout {
  const uid = currentNonRootUid();
  const root = absoluteConfiguredRoot(
    process.env.AIMAUTA_INGEST_ROOT,
    DEFAULT_INGEST_ROOT,
  );
  return {
    root,
    jobs: path.join(root, "jobs"),
    secrets: path.join(root, "secrets"),
    uid,
  };
}

function parseOptions(
  args: readonly string[],
  layout: IngestLayout,
): CliOptions {
  const allowed = new Set([
    "--book",
    "--pdf",
    "--output",
    "--api-key-file",
    "--model",
  ]);
  for (let index = 0; index < args.length; index += 2) {
    if (!allowed.has(args[index]) || !args[index + 1]) {
      throw new IngestCliError(
        "Uso: exercises:ingest --book ID --pdf /ruta/libro.pdf " +
          "--output /ruta/job --api-key-file /ruta/secreto [--model MODELO]",
      );
    }
  }

  const bookId = optionValue(args, "--book");
  const pdfPath = optionValue(args, "--pdf");
  const outputDir = optionValue(args, "--output");
  const apiKeyFile =
    optionValue(args, "--api-key-file") ??
    process.env.AIMAUTA_GEMINI_API_KEY_FILE?.trim() ??
    path.join(layout.secrets, "model-api-key");
  const model =
    optionValue(args, "--model") ??
    process.env.AIMAUTA_GEMINI_MODEL?.trim() ??
    DEFAULT_MODEL;
  if (
    !bookId ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(bookId) ||
    !pdfPath ||
    !path.isAbsolute(pdfPath) ||
    !outputDir ||
    !path.isAbsolute(outputDir) ||
    !apiKeyFile ||
    !path.isAbsolute(apiKeyFile) ||
    !safeModelPattern.test(model)
  ) {
    throw new IngestCliError("La configuración de la ingesta no es válida.");
  }
  return {
    bookId,
    pdfPath: path.resolve(pdfPath),
    outputDir: directChildPath(layout.jobs, outputDir),
    apiKeyFile: directChildPath(layout.secrets, apiKeyFile),
    model,
  };
}

async function readApiKey(
  filePath: string,
  expectedUid: number,
): Promise<string> {
  const source = await readStableOwnedFile(filePath, {
    expectedUid,
    maximumBytes: MAX_API_KEY_BYTES,
    expectedMode: 0o600,
  });
  const raw = source.toString("utf8");
  const apiKey = raw.endsWith("\n") ? raw.slice(0, -1) : raw;
  if (
    !apiKey ||
    apiKey !== apiKey.trim() ||
    apiKey.includes("\n") ||
    apiKey.length > MAX_API_KEY_BYTES
  ) {
    throw new IngestCliError("El archivo de clave no es válido.");
  }
  return apiKey;
}

async function writeArtifacts(input: {
  outputDir: string;
  bookId: string;
  publicManifest: unknown;
  privateManifest: unknown;
  report: unknown;
}): Promise<void> {
  const artifacts = [
    {
      name: `${input.bookId}.public.draft.json`,
      value: input.publicManifest,
    },
    {
      name: `${input.bookId}.private.draft.json`,
      value: input.privateManifest,
    },
    {
      name: `${input.bookId}.ingestion-report.json`,
      value: input.report,
    },
  ];
  const temporaryPaths: string[] = [];

  try {
    for (const artifact of artifacts) {
      const target = path.join(input.outputDir, artifact.name);
      if (await lstat(target).catch(() => null)) {
        throw new IngestCliError(
          "El job ya contiene artefactos; usa un directorio nuevo.",
        );
      }
      const temporary = path.join(
        input.outputDir,
        `.${artifact.name}.${randomUUID()}.tmp`,
      );
      temporaryPaths.push(temporary);
      await writeFile(
        temporary,
        `${JSON.stringify(artifact.value, null, 2)}\n`,
        { flag: "wx", mode: 0o600 },
      );
      await rename(temporary, target);
      temporaryPaths.pop();
    }
  } finally {
    await Promise.all(
      temporaryPaths.map((temporary) =>
        rm(temporary, { force: true }),
      ),
    );
  }
}

async function main(): Promise<void> {
  const layout = ingestLayout();
  await assertOwnedDirectory(layout.root, layout.uid, 0o700);
  await assertOwnedDirectory(layout.jobs, layout.uid, 0o700);
  await assertOwnedDirectory(layout.secrets, layout.uid, 0o700);

  const options = parseOptions(process.argv.slice(2), layout);
  const catalogMatches = getCatalogEntries().filter(
    (entry) => entry.id === options.bookId,
  );
  if (catalogMatches.length !== 1) {
    throw new IngestCliError(
      "El libro debe existir una sola vez en el catálogo versionado.",
    );
  }

  await assertOwnedRegularFile(options.pdfPath, {
    expectedUid: layout.uid,
    maximumBytes: catalogMatches[0].expectedBytes,
  });
  const apiKey = await readApiKey(options.apiKeyFile, layout.uid);
  await prepareOwnedJobDirectory(
    layout.jobs,
    options.outputDir,
    layout.uid,
  );
  const endpoint = process.env.AIMAUTA_GEMINI_ENDPOINT?.trim();
  const nonGoogleEndpointOptIn =
    process.env.AIMAUTA_ALLOW_NON_GOOGLE_GEMINI_ENDPOINT?.trim();
  if (
    nonGoogleEndpointOptIn !== undefined &&
    nonGoogleEndpointOptIn !== "true" &&
    nonGoogleEndpointOptIn !== "false"
  ) {
    throw new IngestCliError(
      "AIMAUTA_ALLOW_NON_GOOGLE_GEMINI_ENDPOINT debe ser true o false.",
    );
  }
  const provider = {
    apiKey,
    model: options.model,
    ...(endpoint
      ? {
          endpoint,
          allowNonGoogleEndpoint: nonGoogleEndpointOptIn === "true",
        }
      : {}),
  };
  const result = await ingestExercisesFromPdf({
    catalogEntry: catalogMatches[0],
    pdfPath: options.pdfPath,
    model: options.model,
    detect: (images) =>
      detectExerciseWindowWithGemma({ ...provider, images }),
    solve: ({ exerciseId, context, images }) =>
      solveExerciseWithGemma({
        ...provider,
        exerciseId,
        context,
        images,
      }),
  });

  await writeArtifacts({
    outputDir: options.outputDir,
    bookId: options.bookId,
    publicManifest: result.publicManifest,
    privateManifest: result.privateManifest,
    report: {
      schemaVersion: 1,
      bookId: options.bookId,
      model: options.model,
      generatedAt: result.publicManifest.generatedAt,
      exerciseCount: result.publicManifest.exercises.length,
      reviewRequired: true,
      issues: result.issues,
    },
  });

  console.log(
    `Ingesta preparada: ${result.publicManifest.exercises.length} ejercicios ` +
      "en estado draft. Revisión humana obligatoria antes de publicar.",
  );
}

main().catch((error: unknown) => {
  const message =
    error instanceof IngestCliError
      ? error.message
      : "La ingesta privada no pudo completarse.";
  console.error(message);
  process.exitCode = 1;
});
