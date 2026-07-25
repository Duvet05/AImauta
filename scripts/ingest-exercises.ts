import { randomUUID } from "node:crypto";
import {
  lstat,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { getAuthoringCatalogEntry } from "@/lib/catalog";
import {
  ingestExercisesFromPdf,
  type DetectExercisesCallback,
  type SolveExerciseCallback,
} from "@/lib/exercise-ingestion";
import {
  detectExerciseWindowWithGemma,
  solveExerciseWithGemma,
} from "@/lib/gemma-ingest";
import {
  detectExerciseWindowWithOllama,
  solveExerciseWithOllama,
} from "@/lib/ollama-gemma-ingest";
import {
  absoluteConfiguredRoot,
  assertOwnedDirectory,
  assertOwnedRegularFile,
  currentNonRootUid,
  directChildPath,
  prepareOwnedJobDirectory,
  readStableOwnedFile,
} from "@/scripts/private-runtime-paths";

const DEFAULT_GOOGLE_MODEL = "gemma-4-26b-a4b-it";
const DEFAULT_OLLAMA_MODEL = "gemma4:e4b-it-qat";
const DEFAULT_INGEST_ROOT = "/home/hii1sc/aimauta-ingest";
const MAX_API_KEY_BYTES = 4_096;
const safeModelPattern = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u;

type IngestProvider = "google" | "ollama";

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
  apiKeyFile?: string;
  provider: IngestProvider;
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
    "--provider",
  ]);
  const seen = new Set<string>();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    if (
      !allowed.has(name) ||
      seen.has(name) ||
      !args[index + 1]
    ) {
      throw new IngestCliError(
        "Uso: exercises:ingest --book ID --pdf /ruta/libro.pdf " +
          "--output /ruta/job [--provider google|ollama] " +
          "[--api-key-file /ruta/secreto] [--model MODELO]",
        );
    }
    seen.add(name);
  }

  const bookId = optionValue(args, "--book");
  const pdfPath = optionValue(args, "--pdf");
  const outputDir = optionValue(args, "--output");
  const providerValue =
    optionValue(args, "--provider") ??
    process.env.AIMAUTA_INGEST_PROVIDER?.trim() ??
    "ollama";
  if (providerValue !== "google" && providerValue !== "ollama") {
    throw new IngestCliError(
      "AIMAUTA_INGEST_PROVIDER debe ser google u ollama.",
    );
  }
  const provider: IngestProvider = providerValue;
  const explicitApiKeyFile = optionValue(args, "--api-key-file");
  if (provider === "ollama" && explicitApiKeyFile) {
    throw new IngestCliError(
      "--api-key-file sólo se admite con el proveedor google.",
    );
  }
  const apiKeyFile =
    provider === "google"
      ? explicitApiKeyFile ??
        process.env.AIMAUTA_GEMINI_API_KEY_FILE?.trim() ??
        path.join(layout.secrets, "model-api-key")
      : undefined;
  const model =
    optionValue(args, "--model") ??
    (provider === "google"
      ? process.env.AIMAUTA_GEMINI_MODEL?.trim() ??
        DEFAULT_GOOGLE_MODEL
      : process.env.AIMAUTA_OLLAMA_INGEST_MODEL?.trim() ??
        DEFAULT_OLLAMA_MODEL);
  if (
    !bookId ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(bookId) ||
    !pdfPath ||
    !path.isAbsolute(pdfPath) ||
    !outputDir ||
    !path.isAbsolute(outputDir) ||
    (apiKeyFile !== undefined && !path.isAbsolute(apiKeyFile)) ||
    !safeModelPattern.test(model) ||
    model.includes("..")
  ) {
    throw new IngestCliError("La configuración de la ingesta no es válida.");
  }
  return {
    bookId,
    pdfPath: path.resolve(pdfPath),
    outputDir: directChildPath(layout.jobs, outputDir),
    ...(apiKeyFile
      ? { apiKeyFile: directChildPath(layout.secrets, apiKeyFile) }
      : {}),
    provider,
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

async function providerCallbacks(
  options: CliOptions,
  expectedUid: number,
): Promise<{
  detect: DetectExercisesCallback;
  solve: SolveExerciseCallback;
}> {
  if (options.provider === "ollama") {
    const baseUrl =
      process.env.AIMAUTA_OLLAMA_INGEST_URL?.trim() ??
      "http://127.0.0.1:11434";
    const provider = {
      baseUrl,
      model: options.model,
    };
    return {
      detect: (images) =>
        detectExerciseWindowWithOllama({ ...provider, images }),
      solve: ({ exerciseId, context, images }) =>
        solveExerciseWithOllama({
          ...provider,
          exerciseId,
          context,
          images,
        }),
    };
  }

  if (!options.apiKeyFile) {
    throw new IngestCliError(
      "El proveedor google requiere un archivo de clave.",
    );
  }
  const apiKey = await readApiKey(options.apiKeyFile, expectedUid);
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
  return {
    detect: (images) =>
      detectExerciseWindowWithGemma({ ...provider, images }),
    solve: ({ exerciseId, context, images }) =>
      solveExerciseWithGemma({
        ...provider,
        exerciseId,
        context,
        images,
      }),
  };
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
  const catalogEntry = getAuthoringCatalogEntry(options.bookId);
  if (!catalogEntry) {
    throw new IngestCliError(
      "El libro debe existir, admitir tutor y no estar deshabilitado.",
    );
  }

  await assertOwnedRegularFile(options.pdfPath, {
    expectedUid: layout.uid,
    maximumBytes: catalogEntry.expectedBytes,
  });
  await prepareOwnedJobDirectory(
    layout.jobs,
    options.outputDir,
    layout.uid,
  );
  const { detect, solve } = await providerCallbacks(options, layout.uid);
  const result = await ingestExercisesFromPdf({
    catalogEntry,
    pdfPath: options.pdfPath,
    model: options.model,
    detect,
    solve,
  });

  await writeArtifacts({
    outputDir: options.outputDir,
    bookId: options.bookId,
    publicManifest: result.publicManifest,
    privateManifest: result.privateManifest,
    report: {
      schemaVersion: 2,
      bookId: options.bookId,
      sourceSha256: result.publicManifest.sourceSha256,
      provider: options.provider,
      endpointScope:
        options.provider === "ollama" ? "loopback" : "google-api",
      model: options.model,
      generatedAt: result.publicManifest.generatedAt,
      exerciseCount: result.publicManifest.exercises.length,
      reviewRequired: true,
      coverage: result.coverage,
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
