import {
  getCatalogEntries,
  type CatalogEntry
} from "@/lib/catalog";
import {
  getPageActivity,
  type PageActivity
} from "@/lib/curriculum";

export const EXERCISE_MANIFEST_SCHEMA_VERSION = 1 as const;
export const EXERCISE_COORDINATE_SPACE =
  "pdfjs-page-image-normalized-v1" as const;

export type NormalizedRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ExerciseRegionRole =
  | "prompt"
  | "context"
  | "figure"
  | "answer-area";

export type ExerciseRegion = {
  id: string;
  page: number;
  role: ExerciseRegionRole;
  order: number;
  rect: NormalizedRect;
};

export type ExerciseStatus =
  | "draft"
  | "review"
  | "published"
  | "disabled";

/**
 * Exercises are deliberately limited to stages where assistance is allowed.
 * Orientation and assessment pages are rejected again at runtime below.
 */
export type ExerciseStage = "learn" | "practice";

export type PublicExercise = {
  id: string;
  status: ExerciseStatus;
  unitId: string;
  stage: ExerciseStage;
  revision: number;
  label: string;
  title: string;
  prompt: string;
  regions: readonly ExerciseRegion[];
};

export type PublicExerciseManifest = {
  schemaVersion: typeof EXERCISE_MANIFEST_SCHEMA_VERSION;
  bookId: string;
  sourceSha256: string;
  pageCount: number;
  coordinateSpace: typeof EXERCISE_COORDINATE_SPACE;
  renderVersion: string;
  model: string;
  generatedAt: string;
  exercises: readonly PublicExercise[];
};

// Short aliases are useful to consumers such as the PDF overlay.
export type Exercise = PublicExercise;
export type ExerciseManifest = PublicExerciseManifest;

export type ExerciseHint = {
  level: 1 | 2 | 3;
  text: string;
};

export type ExerciseRubricItem = {
  criterion: string;
  expectedEvidence: string;
};

/**
 * This is an authored pedagogical artifact, not a model reasoning trace.
 * Raw chain-of-thought has no field in this contract and is explicitly
 * rejected by the parsers.
 */
export type PrivateExerciseSolution = {
  exerciseId: string;
  revision: number;
  reviewed: boolean;
  finalAnswer: string;
  pedagogicalSteps: readonly string[];
  hints: readonly ExerciseHint[];
  rubric: readonly ExerciseRubricItem[];
  confidence: number;
};

export type PrivateExerciseSolutionsManifest = {
  schemaVersion: typeof EXERCISE_MANIFEST_SCHEMA_VERSION;
  bookId: string;
  sourceSha256: string;
  model: string;
  generatedAt: string;
  solutions: readonly PrivateExerciseSolution[];
};

export type ExerciseManifestIssue = {
  code: string;
  path: string;
  message: string;
};

export type ExerciseManifestParseResult<T> =
  | {
      ok: true;
      value: T;
      issues: readonly [];
    }
  | {
      ok: false;
      issues: readonly ExerciseManifestIssue[];
    };

export type ExerciseManifestValidationOptions = {
  catalogEntries?: readonly CatalogEntry[];
  pageActivity?: (bookId: string, page: number) => PageActivity;
};

const publicManifestKeys = new Set([
  "schemaVersion",
  "bookId",
  "sourceSha256",
  "pageCount",
  "coordinateSpace",
  "renderVersion",
  "model",
  "generatedAt",
  "exercises"
]);
const exerciseKeys = new Set([
  "id",
  "status",
  "unitId",
  "stage",
  "revision",
  "label",
  "title",
  "prompt",
  "regions"
]);
const regionKeys = new Set(["id", "page", "role", "order", "rect"]);
const rectKeys = new Set(["x", "y", "width", "height"]);
const privateManifestKeys = new Set([
  "schemaVersion",
  "bookId",
  "sourceSha256",
  "model",
  "generatedAt",
  "solutions"
]);
const solutionKeys = new Set([
  "exerciseId",
  "revision",
  "reviewed",
  "finalAnswer",
  "pedagogicalSteps",
  "hints",
  "rubric",
  "confidence"
]);
const hintKeys = new Set(["level", "text"]);
const rubricItemKeys = new Set(["criterion", "expectedEvidence"]);

const exerciseStatuses = new Set<unknown>([
  "draft",
  "review",
  "published",
  "disabled"
]);
const exerciseStages = new Set<unknown>(["learn", "practice"]);
const regionRoles = new Set<unknown>([
  "prompt",
  "context",
  "figure",
  "answer-area"
]);
const safeIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const sha256Pattern = /^[a-f0-9]{64}$/;
const forbiddenReasoningKeys = new Set([
  "chainofthought",
  "cot",
  "rawreasoning",
  "reasoningtrace",
  "scratchpad",
  "thoughtprocess"
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function isIsoDateTime(value: unknown): value is string {
  return (
    hasText(value) &&
    /^\d{4}-\d{2}-\d{2}T/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function issue(
  issues: ExerciseManifestIssue[],
  code: string,
  path: string,
  message: string
): void {
  issues.push({ code, path, message });
}

function parseJsonInput(
  input: unknown,
  issues: ExerciseManifestIssue[]
): unknown {
  if (typeof input !== "string") {
    return input;
  }
  try {
    return JSON.parse(input) as unknown;
  } catch {
    issue(
      issues,
      "manifest.invalid-json",
      "$",
      "El manifiesto no contiene JSON válido."
    );
    return undefined;
  }
}

function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  path: string,
  issues: ExerciseManifestIssue[]
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      issue(
        issues,
        "manifest.unknown-field",
        `${path}.${key}`,
        `El campo ${key} no pertenece al contrato.`
      );
    }
  }
}

function normalizedReasoningKey(key: string): string {
  return key.toLowerCase().replaceAll(/[^a-z0-9]/g, "");
}

function rejectReasoningTrace(
  value: unknown,
  path: string,
  issues: ExerciseManifestIssue[],
  visited = new WeakSet<object>()
): void {
  if (typeof value !== "object" || value === null) {
    return;
  }
  if (visited.has(value)) {
    return;
  }
  visited.add(value);

  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      rejectReasoningTrace(item, `${path}[${index}]`, issues, visited)
    );
    return;
  }

  for (const [key, nested] of Object.entries(value)) {
    if (forbiddenReasoningKeys.has(normalizedReasoningKey(key))) {
      issue(
        issues,
        "manifest.forbidden-reasoning-trace",
        `${path}.${key}`,
        "No se permite almacenar chain-of-thought ni razonamiento bruto."
      );
    }
    rejectReasoningTrace(nested, `${path}.${key}`, issues, visited);
  }
}

function validateCommonManifestFields(
  value: Record<string, unknown>,
  issues: ExerciseManifestIssue[]
): void {
  if (value.schemaVersion !== EXERCISE_MANIFEST_SCHEMA_VERSION) {
    issue(
      issues,
      "manifest.invalid-schema-version",
      "$.schemaVersion",
      "schemaVersion debe ser 1."
    );
  }
  if (!safeIdPattern.test(String(value.bookId ?? ""))) {
    issue(
      issues,
      "manifest.invalid-book-id",
      "$.bookId",
      "bookId debe ser un slug estable en minúsculas."
    );
  }
  if (
    typeof value.sourceSha256 !== "string" ||
    !sha256Pattern.test(value.sourceSha256)
  ) {
    issue(
      issues,
      "manifest.invalid-source-checksum",
      "$.sourceSha256",
      "sourceSha256 debe ser un SHA-256 hexadecimal en minúsculas."
    );
  }
  if (!hasText(value.model)) {
    issue(
      issues,
      "manifest.missing-model",
      "$.model",
      "Debe registrarse el modelo que generó el artefacto."
    );
  }
  if (!isIsoDateTime(value.generatedAt)) {
    issue(
      issues,
      "manifest.invalid-generated-at",
      "$.generatedAt",
      "generatedAt debe ser una fecha y hora ISO 8601."
    );
  }
}

function validateRectSchema(
  value: unknown,
  path: string,
  issues: ExerciseManifestIssue[]
): void {
  if (!isRecord(value)) {
    issue(
      issues,
      "manifest.invalid-rect",
      path,
      "rect debe ser un objeto con x, y, width y height."
    );
    return;
  }
  rejectUnknownKeys(value, rectKeys, path, issues);

  for (const field of ["x", "y", "width", "height"] as const) {
    const coordinate = value[field];
    if (
      typeof coordinate !== "number" ||
      !Number.isFinite(coordinate) ||
      coordinate < 0 ||
      coordinate > 1
    ) {
      issue(
        issues,
        "manifest.invalid-coordinate",
        `${path}.${field}`,
        `${field} debe ser un número finito entre 0 y 1.`
      );
    }
  }

  if (
    typeof value.width === "number" &&
    Number.isFinite(value.width) &&
    value.width <= 0
  ) {
    issue(
      issues,
      "manifest.empty-rect",
      `${path}.width`,
      "El ancho de una región debe ser mayor que cero."
    );
  }
  if (
    typeof value.height === "number" &&
    Number.isFinite(value.height) &&
    value.height <= 0
  ) {
    issue(
      issues,
      "manifest.empty-rect",
      `${path}.height`,
      "La altura de una región debe ser mayor que cero."
    );
  }
  if (
    typeof value.x === "number" &&
    typeof value.width === "number" &&
    Number.isFinite(value.x) &&
    Number.isFinite(value.width) &&
    value.x + value.width > 1
  ) {
    issue(
      issues,
      "manifest.rect-outside-page",
      path,
      "La región excede el ancho normalizado de la página."
    );
  }
  if (
    typeof value.y === "number" &&
    typeof value.height === "number" &&
    Number.isFinite(value.y) &&
    Number.isFinite(value.height) &&
    value.y + value.height > 1
  ) {
    issue(
      issues,
      "manifest.rect-outside-page",
      path,
      "La región excede la altura normalizada de la página."
    );
  }
}

function validateRegionSchema(
  value: unknown,
  path: string,
  issues: ExerciseManifestIssue[]
): void {
  if (!isRecord(value)) {
    issue(
      issues,
      "manifest.invalid-region",
      path,
      "Cada región debe ser un objeto."
    );
    return;
  }
  rejectUnknownKeys(value, regionKeys, path, issues);

  if (!safeIdPattern.test(String(value.id ?? ""))) {
    issue(
      issues,
      "manifest.invalid-region-id",
      `${path}.id`,
      "El id de región debe ser un slug estable en minúsculas."
    );
  }
  if (!isPositiveInteger(value.page)) {
    issue(
      issues,
      "manifest.invalid-region-page",
      `${path}.page`,
      "La página de una región debe ser un entero positivo."
    );
  }
  if (!regionRoles.has(value.role)) {
    issue(
      issues,
      "manifest.invalid-region-role",
      `${path}.role`,
      "El rol debe ser prompt, context, figure o answer-area."
    );
  }
  if (!isPositiveInteger(value.order)) {
    issue(
      issues,
      "manifest.invalid-region-order",
      `${path}.order`,
      "order debe ser un entero positivo."
    );
  }
  validateRectSchema(value.rect, `${path}.rect`, issues);
}

function validateExerciseSchema(
  value: unknown,
  path: string,
  issues: ExerciseManifestIssue[]
): void {
  if (!isRecord(value)) {
    issue(
      issues,
      "manifest.invalid-exercise",
      path,
      "Cada ejercicio debe ser un objeto."
    );
    return;
  }
  rejectUnknownKeys(value, exerciseKeys, path, issues);

  if (!safeIdPattern.test(String(value.id ?? ""))) {
    issue(
      issues,
      "manifest.invalid-exercise-id",
      `${path}.id`,
      "El id del ejercicio debe ser un slug estable en minúsculas."
    );
  }
  if (!exerciseStatuses.has(value.status)) {
    issue(
      issues,
      "manifest.invalid-exercise-status",
      `${path}.status`,
      "Estado de ejercicio no reconocido."
    );
  }
  if (!safeIdPattern.test(String(value.unitId ?? ""))) {
    issue(
      issues,
      "manifest.invalid-unit-id",
      `${path}.unitId`,
      "unitId debe ser un slug curricular válido."
    );
  }
  if (!exerciseStages.has(value.stage)) {
    issue(
      issues,
      "manifest.forbidden-exercise-stage",
      `${path}.stage`,
      "Los ejercicios sólo pueden pertenecer a learn o practice."
    );
  }
  if (!isPositiveInteger(value.revision)) {
    issue(
      issues,
      "manifest.invalid-exercise-revision",
      `${path}.revision`,
      "revision debe ser un entero positivo."
    );
  }
  for (const field of ["label", "title", "prompt"] as const) {
    if (!hasText(value[field])) {
      issue(
        issues,
        "manifest.missing-exercise-text",
        `${path}.${field}`,
        `${field} es obligatorio.`
      );
    }
  }

  if (!Array.isArray(value.regions) || value.regions.length === 0) {
    issue(
      issues,
      "manifest.empty-exercise-regions",
      `${path}.regions`,
      "Cada ejercicio debe contener al menos una región."
    );
    return;
  }

  const ids = new Set<string>();
  const orders = new Set<number>();
  let previousPage = 0;
  let promptCount = 0;
  value.regions.forEach((region, index) => {
    const regionPath = `${path}.regions[${index}]`;
    validateRegionSchema(region, regionPath, issues);
    if (!isRecord(region)) {
      return;
    }

    if (typeof region.id === "string") {
      if (ids.has(region.id)) {
        issue(
          issues,
          "manifest.duplicate-region-id",
          `${regionPath}.id`,
          `El id de región ${region.id} está repetido en el ejercicio.`
        );
      }
      ids.add(region.id);
    }
    if (typeof region.order === "number") {
      if (orders.has(region.order)) {
        issue(
          issues,
          "manifest.duplicate-region-order",
          `${regionPath}.order`,
          `El orden ${region.order} está repetido en el ejercicio.`
        );
      }
      orders.add(region.order);
      if (region.order !== index + 1) {
        issue(
          issues,
          "manifest.noncontiguous-region-order",
          `${regionPath}.order`,
          "Las regiones deben estar ordenadas de forma contigua desde 1."
        );
      }
    }
    if (
      typeof region.page === "number" &&
      Number.isFinite(region.page)
    ) {
      if (region.page < previousPage) {
        issue(
          issues,
          "manifest.nonmonotonic-region-pages",
          `${regionPath}.page`,
          "Las páginas deben avanzar de forma monotónica según order."
        );
      }
      previousPage = region.page;
    }
    if (region.role === "prompt") {
      promptCount += 1;
    }
  });

  if (promptCount === 0) {
    issue(
      issues,
      "manifest.missing-prompt-region",
      `${path}.regions`,
      "Cada ejercicio debe señalar al menos una región prompt."
    );
  }
}

function validatePublicSchema(
  input: unknown
): ExerciseManifestIssue[] {
  const issues: ExerciseManifestIssue[] = [];
  const value = parseJsonInput(input, issues);
  rejectReasoningTrace(value, "$", issues);
  if (!isRecord(value)) {
    if (issues.length === 0) {
      issue(
        issues,
        "manifest.invalid-root",
        "$",
        "El manifiesto público debe ser un objeto."
      );
    }
    return issues;
  }

  rejectUnknownKeys(value, publicManifestKeys, "$", issues);
  validateCommonManifestFields(value, issues);
  if (!isPositiveInteger(value.pageCount)) {
    issue(
      issues,
      "manifest.invalid-page-count",
      "$.pageCount",
      "pageCount debe ser un entero positivo."
    );
  }
  if (value.coordinateSpace !== EXERCISE_COORDINATE_SPACE) {
    issue(
      issues,
      "manifest.invalid-coordinate-space",
      "$.coordinateSpace",
      `coordinateSpace debe ser ${EXERCISE_COORDINATE_SPACE}.`
    );
  }
  if (!hasText(value.renderVersion)) {
    issue(
      issues,
      "manifest.missing-render-version",
      "$.renderVersion",
      "renderVersion es obligatorio."
    );
  }
  if (!Array.isArray(value.exercises)) {
    issue(
      issues,
      "manifest.invalid-exercises",
      "$.exercises",
      "exercises debe ser un arreglo."
    );
    return issues;
  }

  const exerciseIds = new Set<string>();
  const regionIds = new Set<string>();
  value.exercises.forEach((exercise, exerciseIndex) => {
    const exercisePath = `$.exercises[${exerciseIndex}]`;
    validateExerciseSchema(exercise, exercisePath, issues);
    if (!isRecord(exercise)) {
      return;
    }
    if (typeof exercise.id === "string") {
      if (exerciseIds.has(exercise.id)) {
        issue(
          issues,
          "manifest.duplicate-exercise-id",
          `${exercisePath}.id`,
          `El id de ejercicio ${exercise.id} está repetido.`
        );
      }
      exerciseIds.add(exercise.id);
    }
    if (Array.isArray(exercise.regions)) {
      exercise.regions.forEach((region, regionIndex) => {
        if (!isRecord(region) || typeof region.id !== "string") {
          return;
        }
        if (regionIds.has(region.id)) {
          issue(
            issues,
            "manifest.duplicate-region-id",
            `${exercisePath}.regions[${regionIndex}].id`,
            `El id de región ${region.id} está repetido en el manifiesto.`
          );
        }
        regionIds.add(region.id);
      });
    }
  });

  return issues;
}

function validateStringArray(
  value: unknown,
  path: string,
  issues: ExerciseManifestIssue[]
): void {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((item) => !hasText(item))
  ) {
    issue(
      issues,
      "manifest.invalid-string-list",
      path,
      "Debe ser un arreglo no vacío de textos no vacíos."
    );
  }
}

function validateRubric(
  value: unknown,
  path: string,
  issues: ExerciseManifestIssue[]
): void {
  if (!Array.isArray(value) || value.length === 0) {
    issue(
      issues,
      "manifest.invalid-rubric",
      path,
      "La rúbrica debe contener al menos un criterio."
    );
    return;
  }

  value.forEach((item, index) => {
    const itemPath = `${path}[${index}]`;
    if (!isRecord(item)) {
      issue(
        issues,
        "manifest.invalid-rubric-item",
        itemPath,
        "Cada criterio de rúbrica debe ser un objeto."
      );
      return;
    }
    rejectUnknownKeys(item, rubricItemKeys, itemPath, issues);
    if (!hasText(item.criterion)) {
      issue(
        issues,
        "manifest.invalid-rubric-criterion",
        `${itemPath}.criterion`,
        "El nombre del criterio es obligatorio."
      );
    }
    if (!hasText(item.expectedEvidence)) {
      issue(
        issues,
        "manifest.invalid-rubric-evidence",
        `${itemPath}.expectedEvidence`,
        "La evidencia esperada es obligatoria."
      );
    }
  });
}

function validateSolutionSchema(
  value: unknown,
  path: string,
  issues: ExerciseManifestIssue[]
): void {
  if (!isRecord(value)) {
    issue(
      issues,
      "manifest.invalid-solution",
      path,
      "Cada solución privada debe ser un objeto."
    );
    return;
  }
  rejectUnknownKeys(value, solutionKeys, path, issues);

  if (!safeIdPattern.test(String(value.exerciseId ?? ""))) {
    issue(
      issues,
      "manifest.invalid-solution-exercise-id",
      `${path}.exerciseId`,
      "exerciseId debe ser un slug válido."
    );
  }
  if (!isPositiveInteger(value.revision)) {
    issue(
      issues,
      "manifest.invalid-solution-revision",
      `${path}.revision`,
      "revision debe ser un entero positivo."
    );
  }
  if (typeof value.reviewed !== "boolean") {
    issue(
      issues,
      "manifest.invalid-solution-review",
      `${path}.reviewed`,
      "reviewed debe ser booleano."
    );
  }
  if (!hasText(value.finalAnswer)) {
    issue(
      issues,
      "manifest.missing-final-answer",
      `${path}.finalAnswer`,
      "La respuesta final es obligatoria en el manifiesto privado."
    );
  }
  validateStringArray(
    value.pedagogicalSteps,
    `${path}.pedagogicalSteps`,
    issues
  );
  validateRubric(value.rubric, `${path}.rubric`, issues);

  if (!Array.isArray(value.hints) || value.hints.length !== 3) {
    issue(
      issues,
      "manifest.invalid-hints",
      `${path}.hints`,
      "Debe haber exactamente tres pistas graduadas, niveles 1, 2 y 3."
    );
  } else {
    value.hints.forEach((hint, index) => {
      const hintPath = `${path}.hints[${index}]`;
      if (!isRecord(hint)) {
        issue(
          issues,
          "manifest.invalid-hint",
          hintPath,
          "Cada pista debe ser un objeto."
        );
        return;
      }
      rejectUnknownKeys(hint, hintKeys, hintPath, issues);
      if (hint.level !== index + 1) {
        issue(
          issues,
          "manifest.invalid-hint-level",
          `${hintPath}.level`,
          "Las pistas deben tener niveles únicos 1, 2 y 3, en orden."
        );
      }
      if (!hasText(hint.text)) {
        issue(
          issues,
          "manifest.invalid-hint-text",
          `${hintPath}.text`,
          "El texto de la pista es obligatorio."
        );
      }
    });
  }

  if (
    typeof value.confidence !== "number" ||
    !Number.isFinite(value.confidence) ||
    value.confidence < 0 ||
    value.confidence > 1
  ) {
    issue(
      issues,
      "manifest.invalid-confidence",
      `${path}.confidence`,
      "confidence debe ser un número finito entre 0 y 1."
    );
  }
}

function validatePrivateSchema(
  input: unknown
): ExerciseManifestIssue[] {
  const issues: ExerciseManifestIssue[] = [];
  const value = parseJsonInput(input, issues);
  rejectReasoningTrace(value, "$", issues);
  if (!isRecord(value)) {
    if (issues.length === 0) {
      issue(
        issues,
        "manifest.invalid-root",
        "$",
        "El manifiesto privado debe ser un objeto."
      );
    }
    return issues;
  }

  rejectUnknownKeys(value, privateManifestKeys, "$", issues);
  validateCommonManifestFields(value, issues);
  if (!Array.isArray(value.solutions)) {
    issue(
      issues,
      "manifest.invalid-solutions",
      "$.solutions",
      "solutions debe ser un arreglo."
    );
    return issues;
  }

  const exerciseIds = new Set<string>();
  value.solutions.forEach((solution, index) => {
    const solutionPath = `$.solutions[${index}]`;
    validateSolutionSchema(solution, solutionPath, issues);
    if (!isRecord(solution) || typeof solution.exerciseId !== "string") {
      return;
    }
    if (exerciseIds.has(solution.exerciseId)) {
      issue(
        issues,
        "manifest.duplicate-solution",
        `${solutionPath}.exerciseId`,
        `Hay más de una solución para ${solution.exerciseId}.`
      );
    }
    exerciseIds.add(solution.exerciseId);
  });

  return issues;
}

/**
 * Explicit allow-list projection. Even if a caller passes an object augmented
 * with a private solution or arbitrary model output, only public fields are
 * copied into the result.
 */
export function projectPublicExerciseManifest(
  manifest: PublicExerciseManifest
): PublicExerciseManifest {
  return {
    schemaVersion: EXERCISE_MANIFEST_SCHEMA_VERSION,
    bookId: manifest.bookId,
    sourceSha256: manifest.sourceSha256,
    pageCount: manifest.pageCount,
    coordinateSpace: EXERCISE_COORDINATE_SPACE,
    renderVersion: manifest.renderVersion,
    model: manifest.model,
    generatedAt: manifest.generatedAt,
    exercises: manifest.exercises.map((exercise) => ({
      id: exercise.id,
      status: exercise.status,
      unitId: exercise.unitId,
      stage: exercise.stage,
      revision: exercise.revision,
      label: exercise.label,
      title: exercise.title,
      prompt: exercise.prompt,
      regions: exercise.regions.map((region) => ({
        id: region.id,
        page: region.page,
        role: region.role,
        order: region.order,
        rect: {
          x: region.rect.x,
          y: region.rect.y,
          width: region.rect.width,
          height: region.rect.height
        }
      }))
    }))
  };
}

function projectPrivateSolutionsManifest(
  manifest: PrivateExerciseSolutionsManifest
): PrivateExerciseSolutionsManifest {
  return {
    schemaVersion: EXERCISE_MANIFEST_SCHEMA_VERSION,
    bookId: manifest.bookId,
    sourceSha256: manifest.sourceSha256,
    model: manifest.model,
    generatedAt: manifest.generatedAt,
    solutions: manifest.solutions.map((solution) => ({
      exerciseId: solution.exerciseId,
      revision: solution.revision,
      reviewed: solution.reviewed,
      finalAnswer: solution.finalAnswer,
      pedagogicalSteps: [...solution.pedagogicalSteps],
      hints: solution.hints.map((hint) => ({
        level: hint.level,
        text: hint.text
      })),
      rubric: solution.rubric.map((item) => ({
        criterion: item.criterion,
        expectedEvidence: item.expectedEvidence
      })),
      confidence: solution.confidence
    }))
  };
}

export function parsePublicExerciseManifest(
  input: unknown
): ExerciseManifestParseResult<PublicExerciseManifest> {
  const issues = validatePublicSchema(input);
  if (issues.length > 0) {
    return { ok: false, issues };
  }
  const parsed =
    typeof input === "string" ? (JSON.parse(input) as unknown) : input;
  return {
    ok: true,
    value: projectPublicExerciseManifest(
      parsed as PublicExerciseManifest
    ),
    issues: []
  };
}

export function parsePrivateExerciseSolutionsManifest(
  input: unknown
): ExerciseManifestParseResult<PrivateExerciseSolutionsManifest> {
  const issues = validatePrivateSchema(input);
  if (issues.length > 0) {
    return { ok: false, issues };
  }
  const parsed =
    typeof input === "string" ? (JSON.parse(input) as unknown) : input;
  return {
    ok: true,
    value: projectPrivateSolutionsManifest(
      parsed as PrivateExerciseSolutionsManifest
    ),
    issues: []
  };
}

export function validatePublicExerciseManifest(
  input: unknown
): readonly ExerciseManifestIssue[] {
  return validatePublicSchema(input);
}

export function validatePrivateExerciseSolutionsManifest(
  input: unknown
): readonly ExerciseManifestIssue[] {
  return validatePrivateSchema(input);
}

/**
 * Cross-manifest and curricular safety boundary.
 *
 * It accepts unknown values so callers cannot bypass structural validation by
 * casting API/model output to TypeScript types. No I/O occurs; catalog and
 * page classification dependencies can be injected for deterministic tools
 * and tests.
 */
export function validateExerciseManifests(
  publicInput: unknown,
  privateInput?: unknown,
  options: ExerciseManifestValidationOptions = {}
): readonly ExerciseManifestIssue[] {
  const publicResult = parsePublicExerciseManifest(publicInput);
  if (!publicResult.ok) {
    return publicResult.issues;
  }

  const issues: ExerciseManifestIssue[] = [];
  const publicManifest = publicResult.value;
  let privateManifest: PrivateExerciseSolutionsManifest | undefined;
  if (privateInput !== undefined) {
    const privateResult =
      parsePrivateExerciseSolutionsManifest(privateInput);
    if (!privateResult.ok) {
      return privateResult.issues.map((entry) => ({
        ...entry,
        path: `$private${entry.path.slice(1)}`
      }));
    }
    privateManifest = privateResult.value;
  }

  const catalogEntries =
    options.catalogEntries ?? getCatalogEntries();
  const matchingCatalogEntries = catalogEntries.filter(
    (entry) => entry.id === publicManifest.bookId
  );
  if (matchingCatalogEntries.length !== 1) {
    issue(
      issues,
      "manifest.catalog-book-not-unique",
      "$.bookId",
      "bookId debe corresponder exactamente a una entrada del catálogo."
    );
  }
  const catalogEntry = matchingCatalogEntries[0];
  if (catalogEntry) {
    if (catalogEntry.expectedSha256 !== publicManifest.sourceSha256) {
      issue(
        issues,
        "manifest.catalog-checksum-mismatch",
        "$.sourceSha256",
        "El checksum del manifiesto no coincide con el PDF del catálogo."
      );
    }
    if (catalogEntry.pages !== publicManifest.pageCount) {
      issue(
        issues,
        "manifest.catalog-page-count-mismatch",
        "$.pageCount",
        "pageCount no coincide con el número de páginas del catálogo."
      );
    }
  }

  if (privateManifest) {
    if (privateManifest.bookId !== publicManifest.bookId) {
      issue(
        issues,
        "manifest.private-book-mismatch",
        "$private.bookId",
        "El manifiesto privado pertenece a otro libro."
      );
    }
    if (privateManifest.sourceSha256 !== publicManifest.sourceSha256) {
      issue(
        issues,
        "manifest.private-checksum-mismatch",
        "$private.sourceSha256",
        "El manifiesto privado pertenece a otra revisión del PDF."
      );
    }
  }

  const classifyPage = options.pageActivity ?? getPageActivity;
  const exerciseIds = new Set(
    publicManifest.exercises.map((exercise) => exercise.id)
  );
  const solutions = new Map(
    (privateManifest?.solutions ?? []).map((solution) => [
      solution.exerciseId,
      solution
    ])
  );

  for (const [exerciseIndex, exercise] of
    publicManifest.exercises.entries()) {
    const exercisePath = `$.exercises[${exerciseIndex}]`;
    let expectedUnit: string | null = null;
    let expectedStage: string | null = null;

    for (const [regionIndex, region] of exercise.regions.entries()) {
      const regionPath = `${exercisePath}.regions[${regionIndex}]`;
      if (region.page > publicManifest.pageCount) {
        issue(
          issues,
          "manifest.region-page-out-of-range",
          `${regionPath}.page`,
          "La región apunta fuera del PDF."
        );
        continue;
      }

      const activity = classifyPage(publicManifest.bookId, region.page);
      if (
        activity.stage === "assessment" ||
        activity.stage === "orientation" ||
        !activity.tutorAvailable
      ) {
        issue(
          issues,
          "manifest.forbidden-curriculum-page",
          `${regionPath}.page`,
          "No se permiten ejercicios en orientación, evaluación o páginas no clasificadas."
        );
      }
      if (
        activity.unitId !== exercise.unitId ||
        activity.stage !== exercise.stage
      ) {
        issue(
          issues,
          "manifest.region-curriculum-mismatch",
          regionPath,
          "La región no coincide con unitId y stage del ejercicio."
        );
      }

      if (expectedUnit === null) {
        expectedUnit = activity.unitId;
        expectedStage = activity.stage;
      } else if (
        activity.unitId !== expectedUnit ||
        activity.stage !== expectedStage
      ) {
        issue(
          issues,
          "manifest.exercise-crosses-curriculum-boundary",
          regionPath,
          "Un ejercicio no puede cruzar unidades ni etapas curriculares."
        );
      }
    }

    if (exercise.status === "published") {
      const solution = solutions.get(exercise.id);
      if (!solution) {
        issue(
          issues,
          "manifest.published-missing-solution",
          exercisePath,
          "Un ejercicio published requiere una solución privada."
        );
      } else {
        if (!solution.reviewed) {
          issue(
            issues,
            "manifest.published-solution-not-reviewed",
            `$private.solutions.${exercise.id}`,
            "La solución de un ejercicio published debe estar revisada."
          );
        }
        if (solution.revision !== exercise.revision) {
          issue(
            issues,
            "manifest.published-solution-revision-mismatch",
            `$private.solutions.${exercise.id}.revision`,
            "La solución revisada debe corresponder a la revisión publicada."
          );
        }
      }
    }
  }

  for (const solution of privateManifest?.solutions ?? []) {
    if (!exerciseIds.has(solution.exerciseId)) {
      issue(
        issues,
        "manifest.orphan-solution",
        `$private.solutions.${solution.exerciseId}`,
        "La solución privada no corresponde a ningún ejercicio."
      );
    }
  }

  return issues;
}
