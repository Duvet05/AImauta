import { lstat, readFile } from "node:fs/promises";
import path from "node:path";

import {
  parsePrivateExerciseSolutionsManifest,
  parsePublicExerciseManifest,
  validateExerciseManifests,
} from "@/lib/exercise-manifest";

const MAX_MANIFEST_BYTES = 16 * 1024 * 1024;

class ReleaseValidationError extends Error {}

function parsePathOption(
  args: readonly string[],
  option: string,
): string {
  const index = args.indexOf(option);
  if (
    index < 0 ||
    args.lastIndexOf(option) !== index ||
    !args[index + 1] ||
    !path.isAbsolute(args[index + 1])
  ) {
    throw new ReleaseValidationError(
      "Uso: exercises:validate --public /ruta/public.json " +
        "--private /ruta/private.json",
    );
  }
  return args[index + 1];
}

async function readPinnedManifest(filePath: string): Promise<string> {
  const before = await lstat(filePath).catch(() => null);
  if (
    !before ||
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.size < 1 ||
    before.size > MAX_MANIFEST_BYTES
  ) {
    throw new ReleaseValidationError(
      "Los manifiestos deben ser archivos regulares de hasta 16 MiB.",
    );
  }
  const source = await readFile(filePath, "utf8");
  const after = await lstat(filePath);
  if (
    before.dev !== after.dev ||
    before.ino !== after.ino ||
    before.size !== after.size ||
    before.mtimeMs !== after.mtimeMs ||
    before.ctimeMs !== after.ctimeMs
  ) {
    throw new ReleaseValidationError(
      "Un manifiesto cambió durante la validación.",
    );
  }
  return source;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (
    args.length !== 4 ||
    args.some(
      (value, index) =>
        index % 2 === 0 &&
        value !== "--public" &&
        value !== "--private",
    )
  ) {
    throw new ReleaseValidationError(
      "Uso: exercises:validate --public /ruta/public.json " +
        "--private /ruta/private.json",
    );
  }
  const publicPath = parsePathOption(args, "--public");
  const privatePath = parsePathOption(args, "--private");
  const [publicSource, privateSource] = await Promise.all([
    readPinnedManifest(publicPath),
    readPinnedManifest(privatePath),
  ]);
  const publicResult = parsePublicExerciseManifest(publicSource);
  const privateResult =
    parsePrivateExerciseSolutionsManifest(privateSource);
  if (!publicResult.ok || !privateResult.ok) {
    const issues = [
      ...(publicResult.ok ? [] : publicResult.issues),
      ...(privateResult.ok ? [] : privateResult.issues),
    ];
    throw new ReleaseValidationError(
      `Manifiestos inválidos:\n${issues
        .map((entry) => `- ${entry.code} ${entry.path}`)
        .join("\n")}`,
    );
  }

  const pending = publicResult.value.exercises.filter(
    (exercise) =>
      exercise.status === "draft" || exercise.status === "review",
  );
  const published = publicResult.value.exercises.filter(
    (exercise) => exercise.status === "published",
  );
  const issues = validateExerciseManifests(
    publicResult.value,
    privateResult.value,
  );
  if (pending.length > 0 || published.length === 0 || issues.length > 0) {
    const details = [
      ...pending.map(
        (exercise) =>
          `exercise.pending $.exercises.${exercise.id}`,
      ),
      ...(published.length === 0
        ? ["exercise.none-published $.exercises"]
        : []),
      ...issues.map((entry) => `${entry.code} ${entry.path}`),
    ];
    throw new ReleaseValidationError(
      `El release no está listo:\n${details
        .map((entry) => `- ${entry}`)
        .join("\n")}`,
    );
  }

  console.log(
    `✓ Release de ${publicResult.value.bookId}: ` +
      `${published.length} ejercicios publicados, ` +
      `${publicResult.value.exercises.length - published.length} deshabilitados.`,
  );
}

main().catch((error: unknown) => {
  console.error(
    error instanceof ReleaseValidationError
      ? error.message
      : "No se pudo validar el release de ejercicios.",
  );
  process.exitCode = 1;
});
