import { validateCatalogCurriculum } from "../lib/catalog-validation";

const issues = validateCatalogCurriculum();

if (issues.length === 0) {
  process.stdout.write("✓ Catálogo curricular válido y completamente clasificado.\n");
} else {
  for (const issue of issues) {
    process.stderr.write(
      `[${issue.code}] ${issue.id}: ${issue.message}\n`
    );
  }
  process.exitCode = 1;
}
