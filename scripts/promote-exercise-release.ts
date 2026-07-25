import {
  ExerciseReleasePromotionError,
  promoteExerciseRelease,
} from "@/scripts/exercise-release-promotion";

function optionValue(
  args: readonly string[],
  name: string,
): string | undefined {
  const index = args.indexOf(name);
  if (
    index < 0 ||
    args.lastIndexOf(name) !== index ||
    !args[index + 1] ||
    args[index + 1].startsWith("--")
  ) {
    return undefined;
  }
  return args[index + 1];
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (
    args.length !== 4 ||
    args.some(
      (value, index) =>
        index % 2 === 0 && value !== "--job" && value !== "--book",
    )
  ) {
    throw new ExerciseReleasePromotionError(
      "Uso: exercises:promote --job JOB_ID --book BOOK_ID",
    );
  }
  const jobId = optionValue(args, "--job");
  const bookId = optionValue(args, "--book");
  if (!jobId || !bookId) {
    throw new ExerciseReleasePromotionError(
      "Uso: exercises:promote --job JOB_ID --book BOOK_ID",
    );
  }

  const result = await promoteExerciseRelease({ jobId, bookId });
  console.log(
    `✓ Release ${result.releaseId}: ${result.publishedExercises} ejercicios ` +
      `publicados para ${result.bookId}.`,
  );
}

main().catch((error: unknown) => {
  console.error(
    error instanceof ExerciseReleasePromotionError
      ? error.message
      : "No se pudo promover el release de ejercicios.",
  );
  process.exitCode = 1;
});
