import { createHash } from "node:crypto";

import type { CatalogEntry } from "@/lib/catalog";
import {
  EXERCISE_COORDINATE_SPACE,
  EXERCISE_MANIFEST_SCHEMA_VERSION,
  type ExerciseRegionRole,
  type ExerciseStage,
  type NormalizedRect,
  type PrivateExerciseSolutionsManifest,
  type PublicExercise,
  type PublicExerciseManifest,
  validateExerciseManifests
} from "@/lib/exercise-manifest";
import type {
  DetectedExercise,
  ExerciseDetectionResult,
  ExerciseRegion as DetectedRegion,
  ExerciseSolution,
  NormalizedBox
} from "@/lib/gemma-ingest";
import {
  getAuthoringPageActivity,
  type PageActivity
} from "@/lib/curriculum";
import {
  openPdfPageRenderer,
  PDF_RENDER_VERSION,
  type OpenPdfPageRendererInput,
  type PdfPageRenderer,
  type RenderedPdfPage
} from "@/lib/pdf-page-renderer";

const WINDOW_SIZE = 3;
const WINDOW_OVERLAP = 1;
const MAX_EXERCISE_PAGES = 6;
const MAX_DETECTED_CANDIDATES = 512;
const MAX_SOLUTION_CALLS = 256;
const STABLE_ID_COORDINATE_QUANTUM = 20;
const LOW_CONFIDENCE = 0.75;
const sha256Pattern = /^[a-f0-9]{64}$/u;

export type DetectExercisesCallback = (
  images: readonly RenderedPdfPage[]
) => Promise<ExerciseDetectionResult>;

export type SolveExerciseCallback = (input: {
  exerciseId: string;
  context: string;
  images: readonly RenderedPdfPage[];
}) => Promise<ExerciseSolution>;

export type ExerciseIngestionIssue = {
  code:
    | "candidate-forbidden-page"
    | "candidate-crosses-curriculum"
    | "candidate-too-many-pages"
    | "candidate-low-confidence"
    | "solution-low-confidence";
  candidateId: string;
};

export type ExercisePageReviewStatus =
  ExerciseDetectionResult["pagesReviewed"][number]["status"];

export type ExercisePageCoverage = {
  page: number;
  status: ExercisePageReviewStatus;
  candidateCount: number;
};

export type ExerciseCoverageBlocker = {
  code: "page-uncertain" | "page-status-conflict";
  page: number;
};

export type ExerciseIngestionCoverage = {
  pageCount: number;
  pagesReviewed: readonly ExercisePageCoverage[];
  blockers: readonly ExerciseCoverageBlocker[];
};

export type ExerciseIngestionInput = {
  catalogEntry: CatalogEntry;
  pdfPath: string;
  model: string;
  detect: DetectExercisesCallback;
  solve: SolveExerciseCallback;
  pageActivity?: (bookId: string, page: number) => PageActivity;
  now?: () => Date;
  openRenderer?: (
    input: OpenPdfPageRendererInput
  ) => Promise<PdfPageRenderer>;
};

export type ExerciseIngestionResult = {
  publicManifest: PublicExerciseManifest;
  privateManifest: PrivateExerciseSolutionsManifest;
  coverage: ExerciseIngestionCoverage;
  issues: readonly ExerciseIngestionIssue[];
};

export type ExerciseIngestionErrorCode =
  | "INVALID_INPUT"
  | "INVALID_DETECTION"
  | "DETECTION_FAILED"
  | "SOLUTION_FAILED"
  | "BUDGET_EXCEEDED"
  | "MANIFEST_INVALID";

export class ExerciseIngestionError extends Error {
  readonly code: ExerciseIngestionErrorCode;

  constructor(code: ExerciseIngestionErrorCode) {
    const messages: Record<ExerciseIngestionErrorCode, string> = {
      INVALID_INPUT: "La configuración de ingesta no es válida.",
      INVALID_DETECTION: "La detección de ejercicios no es válida.",
      DETECTION_FAILED: "No se pudo completar la detección del libro.",
      SOLUTION_FAILED: "No se pudo pre-resolver un ejercicio detectado.",
      BUDGET_EXCEEDED:
        "La ingesta superó el presupuesto seguro de candidatos o soluciones.",
      MANIFEST_INVALID: "Los manifiestos generados no superaron la validación."
    };
    super(messages[code]);
    this.name = "ExerciseIngestionError";
    this.code = code;
  }
}

type Candidate = {
  candidateId: string;
  printedLabel: string;
  kind: DetectedExercise["kind"];
  promptText: string;
  continuation: DetectedExercise["continuation"];
  confidence: number;
  regions: Array<{
    page: number;
    box2d: NormalizedBox;
    role: DetectedRegion["role"];
  }>;
};

type CandidateGroup = {
  candidateIds: string[];
  printedLabel: string;
  kind: Candidate["kind"];
  promptText: string;
  confidence: number;
  regions: Candidate["regions"];
};

function fail(code: ExerciseIngestionErrorCode): never {
  throw new ExerciseIngestionError(code);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function buildOverlappingPageWindows(
  pageCount: number
): number[][] {
  if (!Number.isSafeInteger(pageCount) || pageCount < 1 || pageCount > 10_000) {
    fail("INVALID_INPUT");
  }
  const windows: number[][] = [];
  let start = 1;
  while (start <= pageCount) {
    const end = Math.min(pageCount, start + WINDOW_SIZE - 1);
    windows.push(
      Array.from({ length: end - start + 1 }, (_, index) => start + index)
    );
    if (end === pageCount) {
      break;
    }
    start = end - WINDOW_OVERLAP + 1;
  }
  return windows;
}

function validBox(value: unknown): value is NormalizedBox {
  if (
    !Array.isArray(value) ||
    value.length !== 4 ||
    !value.every(
      (coordinate) =>
        Number.isInteger(coordinate) && coordinate >= 0 && coordinate <= 1_000
    )
  ) {
    return false;
  }
  return value[0] < value[2] && value[1] < value[3];
}

function normalizeCandidate(
  value: unknown,
  windowPages: ReadonlySet<number>
): Candidate {
  if (
    !isRecord(value) ||
    typeof value.candidateId !== "string" ||
    value.candidateId.length < 1 ||
    value.candidateId.length > 120 ||
    typeof value.printedLabel !== "string" ||
    value.printedLabel.length > 120 ||
    (value.kind !== "problem" &&
      value.kind !== "question_set" &&
      value.kind !== "worked_example") ||
    typeof value.promptText !== "string" ||
    value.promptText.trim().length === 0 ||
    value.promptText.length > 8_000 ||
    (value.continuation !== "none" &&
      value.continuation !== "from_previous" &&
      value.continuation !== "to_next" &&
      value.continuation !== "both") ||
    typeof value.confidence !== "number" ||
    !Number.isFinite(value.confidence) ||
    value.confidence < 0 ||
    value.confidence > 1 ||
    !Array.isArray(value.regions) ||
    value.regions.length < 1 ||
    value.regions.length > 24
  ) {
    fail("INVALID_DETECTION");
  }

  const regions: Candidate["regions"] = [];
  for (const valueRegion of value.regions) {
    if (
      !isRecord(valueRegion) ||
      !Number.isSafeInteger(valueRegion.page) ||
      !windowPages.has(Number(valueRegion.page)) ||
      !validBox(valueRegion.box2d) ||
      (valueRegion.role !== "statement" &&
        valueRegion.role !== "figure" &&
        valueRegion.role !== "options" &&
        valueRegion.role !== "answer_area" &&
        valueRegion.role !== "continuation")
    ) {
      fail("INVALID_DETECTION");
    }
    regions.push({
      page: Number(valueRegion.page),
      box2d: [
        valueRegion.box2d[0],
        valueRegion.box2d[1],
        valueRegion.box2d[2],
        valueRegion.box2d[3]
      ],
      role: valueRegion.role
    });
  }

  return {
    candidateId: value.candidateId,
    printedLabel: value.printedLabel.trim(),
    kind: value.kind,
    promptText: value.promptText.trim(),
    continuation: value.continuation,
    confidence: value.confidence,
    regions
  };
}

type NormalizedDetection = {
  candidates: Candidate[];
  pagesReviewed: Array<{
    page: number;
    status: ExercisePageReviewStatus;
  }>;
};

function normalizeDetection(
  value: unknown,
  pages: readonly number[]
): NormalizedDetection {
  if (
    !isRecord(value) ||
    !Array.isArray(value.pagesReviewed) ||
    value.pagesReviewed.length !== pages.length ||
    !Array.isArray(value.exercises) ||
    value.exercises.length > 100
  ) {
    fail("INVALID_DETECTION");
  }

  const pageSet = new Set(pages);
  const reviewed = new Map<number, ExercisePageReviewStatus>();
  for (const entry of value.pagesReviewed) {
    if (
      !isRecord(entry) ||
      !Number.isSafeInteger(entry.page) ||
      !pageSet.has(Number(entry.page)) ||
      reviewed.has(Number(entry.page)) ||
      (entry.status !== "no_exercise" &&
        entry.status !== "exercise_found" &&
        entry.status !== "uncertain")
    ) {
      fail("INVALID_DETECTION");
    }
    reviewed.set(Number(entry.page), entry.status);
  }
  if (pages.some((page) => !reviewed.has(page))) {
    fail("INVALID_DETECTION");
  }

  const candidates = value.exercises.map((exercise) =>
    normalizeCandidate(exercise, pageSet)
  );
  const candidatesPerPage = new Map<number, number>();
  for (const candidate of candidates) {
    for (const page of new Set(candidate.regions.map((region) => region.page))) {
      candidatesPerPage.set(page, (candidatesPerPage.get(page) ?? 0) + 1);
    }
  }

  const pagesReviewed = pages.map((page) => {
    const status = reviewed.get(page) as ExercisePageReviewStatus;
    const candidateCount = candidatesPerPage.get(page) ?? 0;
    if (
      (status === "no_exercise" && candidateCount !== 0) ||
      (status === "exercise_found" && candidateCount < 1)
    ) {
      fail("INVALID_DETECTION");
    }
    return { page, status };
  });

  return { candidates, pagesReviewed };
}

function normalizedWords(value: string): Set<string> {
  return new Set(
    value
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLocaleLowerCase("es-PE")
      .split(/[^\p{Letter}\p{Number}]+/u)
      .filter((word) => word.length >= 2)
  );
}

function textSimilarity(left: string, right: string): number {
  const leftWords = normalizedWords(left);
  const rightWords = normalizedWords(right);
  if (leftWords.size === 0 || rightWords.size === 0) {
    return 0;
  }
  let intersection = 0;
  for (const word of leftWords) {
    if (rightWords.has(word)) {
      intersection += 1;
    }
  }
  return intersection / (leftWords.size + rightWords.size - intersection);
}

function intersectionOverUnion(
  left: NormalizedBox,
  right: NormalizedBox
): number {
  const ymin = Math.max(left[0], right[0]);
  const xmin = Math.max(left[1], right[1]);
  const ymax = Math.min(left[2], right[2]);
  const xmax = Math.min(left[3], right[3]);
  const intersection =
    Math.max(0, ymax - ymin) * Math.max(0, xmax - xmin);
  if (intersection === 0) {
    return 0;
  }
  const leftArea = (left[2] - left[0]) * (left[3] - left[1]);
  const rightArea = (right[2] - right[0]) * (right[3] - right[1]);
  return intersection / (leftArea + rightArea - intersection);
}

function sharedRegionOverlap(left: Candidate, right: Candidate): number {
  let maximum = 0;
  for (const leftRegion of left.regions) {
    for (const rightRegion of right.regions) {
      if (leftRegion.page === rightRegion.page) {
        maximum = Math.max(
          maximum,
          intersectionOverUnion(leftRegion.box2d, rightRegion.box2d)
        );
      }
    }
  }
  return maximum;
}

function normalizedLabel(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("es-PE")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "");
}

function stableIdentityLabel(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("es-PE")
    .trim()
    .replace(/\s+/gu, "")
    .replace(
      /(^[^\p{Letter}\p{Number}]+|[^\p{Letter}\p{Number}]+$)/gu,
      ""
    );
}

function candidatesSemanticallyCompatible(
  left: Candidate,
  right: Candidate
): boolean {
  if (left.kind !== right.kind) {
    return false;
  }

  const leftLabel = normalizedLabel(left.printedLabel);
  const rightLabel = normalizedLabel(right.printedLabel);
  const bothLabeled = leftLabel.length > 0 && rightLabel.length > 0;
  const sameLabel = bothLabeled && leftLabel === rightLabel;
  if (bothLabeled && !sameLabel) {
    return false;
  }

  const similarity = textSimilarity(left.promptText, right.promptText);
  return sameLabel ? similarity >= 0.3 : similarity >= 0.65;
}

function candidatesMatch(left: Candidate, right: Candidate): boolean {
  if (!candidatesSemanticallyCompatible(left, right)) {
    return false;
  }

  const overlap = sharedRegionOverlap(left, right);
  if (overlap >= 0.82) {
    return true;
  }
  if (overlap < 0.55) {
    return false;
  }

  const sameLabel =
    normalizedLabel(left.printedLabel).length > 0 &&
    normalizedLabel(left.printedLabel) ===
      normalizedLabel(right.printedLabel);
  const continuation =
    left.continuation !== "none" || right.continuation !== "none";
  return sameLabel || continuation;
}

function candidateSortKey(candidate: Candidate): string {
  const regions = [...candidate.regions]
    .sort(
      (left, right) =>
        left.page - right.page ||
        left.box2d[0] - right.box2d[0] ||
        left.box2d[1] - right.box2d[1] ||
        left.role.localeCompare(right.role)
    )
    .map((region) => `${region.page}:${region.box2d.join(",")}:${region.role}`)
    .join("|");
  return [
    regions,
    candidate.printedLabel,
    candidate.promptText,
    candidate.candidateId
  ].join("\u0001");
}

const rolePriority: Readonly<Record<DetectedRegion["role"], number>> = {
  statement: 0,
  figure: 1,
  options: 2,
  answer_area: 3,
  continuation: 4
};

function deduplicateRegions(
  candidates: readonly Candidate[]
): Candidate["regions"] {
  const ordered = candidates
    .flatMap((candidate) => candidate.regions)
    .sort(
      (left, right) =>
        left.page - right.page ||
        left.box2d[0] - right.box2d[0] ||
        left.box2d[1] - right.box2d[1] ||
        left.box2d[2] - right.box2d[2] ||
        left.box2d[3] - right.box2d[3] ||
        rolePriority[left.role] - rolePriority[right.role]
    );

  const regions: Candidate["regions"] = [];
  for (const region of ordered) {
    const duplicateIndex = regions.findIndex(
      (existing) =>
        existing.page === region.page &&
        intersectionOverUnion(existing.box2d, region.box2d) >= 0.88
    );
    if (duplicateIndex === -1) {
      regions.push({
        page: region.page,
        box2d: [...region.box2d],
        role: region.role
      });
      continue;
    }
    const existing = regions[duplicateIndex];
    if (rolePriority[region.role] < rolePriority[existing.role]) {
      regions[duplicateIndex] = {
        page: existing.page,
        box2d: existing.box2d,
        role: region.role
      };
    }
  }

  if (!regions.some((region) => region.role === "statement")) {
    regions[0] = { ...regions[0], role: "statement" };
  }
  return regions;
}

function groupCandidates(values: readonly Candidate[]): CandidateGroup[] {
  const candidates = [...values].sort((left, right) =>
    candidateSortKey(left).localeCompare(candidateSortKey(right))
  );
  const groups: Candidate[][] = [];
  for (const candidate of candidates) {
    const group = groups.find(
      (members) =>
        members.some((member) => candidatesMatch(member, candidate)) &&
        members.every((member) =>
          candidatesSemanticallyCompatible(member, candidate)
        )
    );
    if (group) {
      group.push(candidate);
    } else {
      groups.push([candidate]);
    }
  }

  return groups
    .map((members): CandidateGroup => {
      const prompts = members
        .map((member) => member.promptText)
        .sort(
          (left, right) =>
            right.length - left.length || left.localeCompare(right)
        );
      const labels = members
        .map((member) => member.printedLabel)
        .filter(Boolean)
        .sort((left, right) => left.localeCompare(right));
      const kinds = members
        .map((member) => member.kind)
        .sort((left, right) => left.localeCompare(right));
      return {
        candidateIds: members
          .map((member) => member.candidateId)
          .sort((left, right) => left.localeCompare(right)),
        printedLabel: labels[0] ?? "",
        kind: kinds[0],
        promptText: prompts[0],
        confidence: Math.min(...members.map((member) => member.confidence)),
        regions: deduplicateRegions(members)
      };
    })
    .sort((left, right) => {
      const leftRegion = left.regions[0];
      const rightRegion = right.regions[0];
      return (
        leftRegion.page - rightRegion.page ||
        leftRegion.box2d[0] - rightRegion.box2d[0] ||
        leftRegion.box2d[1] - rightRegion.box2d[1] ||
        left.promptText.localeCompare(right.promptText)
      );
    });
}

function buildIngestionCoverage(
  pageCount: number,
  observations: ReadonlyMap<number, readonly ExercisePageReviewStatus[]>,
  groups: readonly CandidateGroup[]
): ExerciseIngestionCoverage {
  const candidatesPerPage = new Map<number, number>();
  for (const group of groups) {
    for (const page of new Set(group.regions.map((region) => region.page))) {
      candidatesPerPage.set(page, (candidatesPerPage.get(page) ?? 0) + 1);
    }
  }

  const pagesReviewed: ExercisePageCoverage[] = [];
  const blockers: ExerciseCoverageBlocker[] = [];
  for (let page = 1; page <= pageCount; page += 1) {
    const pageObservations = observations.get(page);
    if (!pageObservations || pageObservations.length === 0) {
      fail("INVALID_DETECTION");
    }
    const statuses = new Set(pageObservations);
    const status =
      statuses.size === 1
        ? (pageObservations[0] as ExercisePageReviewStatus)
        : "uncertain";
    const candidateCount = candidatesPerPage.get(page) ?? 0;
    if (
      (status === "no_exercise" && candidateCount !== 0) ||
      (status === "exercise_found" && candidateCount < 1)
    ) {
      fail("INVALID_DETECTION");
    }
    pagesReviewed.push({ page, status, candidateCount });

    if (statuses.size > 1) {
      blockers.push({ code: "page-status-conflict", page });
    } else if (status === "uncertain") {
      blockers.push({ code: "page-uncertain", page });
    }
  }

  return { pageCount, pagesReviewed, blockers };
}

function normalizedRect(box: NormalizedBox): NormalizedRect {
  return {
    x: box[1] / 1_000,
    y: box[0] / 1_000,
    width: (box[3] - box[1]) / 1_000,
    height: (box[2] - box[0]) / 1_000
  };
}

function manifestRole(
  role: DetectedRegion["role"]
): ExerciseRegionRole {
  switch (role) {
    case "statement":
      return "prompt";
    case "figure":
      return "figure";
    case "answer_area":
      return "answer-area";
    case "options":
    case "continuation":
      return "context";
  }
}

function stableExerciseId(
  bookId: string,
  group: CandidateGroup
): string {
  const geometry = [
    ...new Set(
      group.regions.map((region) => {
        const quantizedBox = region.box2d.map((coordinate) =>
          Math.max(
            0,
            Math.min(
              1_000,
              Math.round(coordinate / STABLE_ID_COORDINATE_QUANTUM) *
                STABLE_ID_COORDINATE_QUANTUM
            )
          )
        );
        return `${region.page}:${quantizedBox.join(",")}`;
      })
    )
  ].sort((left, right) => left.localeCompare(right));
  const pages = [
    ...new Set(group.regions.map((region) => region.page))
  ].sort((left, right) => left - right);
  const canonical = JSON.stringify({
    bookId,
    label: stableIdentityLabel(group.printedLabel),
    kind: group.kind,
    pages,
    geometry
  });
  return `exercise-${createHash("sha256").update(canonical).digest("hex").slice(0, 24)}`;
}

function classifyGroup(
  bookId: string,
  group: CandidateGroup,
  classify: (bookId: string, page: number) => PageActivity
):
  | { ok: true; unitId: string; stage: ExerciseStage }
  | { ok: false; code: ExerciseIngestionIssue["code"] } {
  const activities = group.regions.map((region) =>
    classify(bookId, region.page)
  );
  if (
    activities.some(
      (activity) =>
        !activity.tutorAvailable ||
        activity.unitId === null ||
        (activity.stage !== "learn" && activity.stage !== "practice")
    )
  ) {
    return { ok: false, code: "candidate-forbidden-page" };
  }

  const first = activities[0];
  if (
    activities.some(
      (activity) =>
        activity.unitId !== first.unitId || activity.stage !== first.stage
    )
  ) {
    return { ok: false, code: "candidate-crosses-curriculum" };
  }
  return {
    ok: true,
    unitId: first.unitId as string,
    stage: first.stage as ExerciseStage
  };
}

function publicExercise(input: {
  bookId: string;
  group: CandidateGroup;
  unitId: string;
  stage: ExerciseStage;
}): PublicExercise {
  const id = stableExerciseId(input.bookId, input.group);
  const label = input.group.printedLabel || "Ejercicio";
  const title = input.group.printedLabel
    ? `Ejercicio ${input.group.printedLabel}`
    : input.group.promptText.slice(0, 120);
  return {
    id,
    status: "draft",
    unitId: input.unitId,
    stage: input.stage,
    revision: 1,
    label,
    title,
    prompt: input.group.promptText,
    regions: input.group.regions.map((region, index) => ({
      id: `${id}-region-${index + 1}`,
      page: region.page,
      role: manifestRole(region.role),
      order: index + 1,
      rect: normalizedRect(region.box2d)
    }))
  };
}

function solutionContext(
  exercise: PublicExercise,
  kind: CandidateGroup["kind"]
): string {
  return JSON.stringify({
    exerciseId: exercise.id,
    label: exercise.label,
    kind,
    prompt: exercise.prompt,
    pages: [...new Set(exercise.regions.map((region) => region.page))]
  });
}

function validateInput(input: ExerciseIngestionInput): void {
  if (
    !isRecord(input.catalogEntry) ||
    typeof input.catalogEntry.id !== "string" ||
    !Number.isSafeInteger(input.catalogEntry.pages) ||
    input.catalogEntry.pages < 1 ||
    typeof input.catalogEntry.expectedSha256 !== "string" ||
    !sha256Pattern.test(input.catalogEntry.expectedSha256) ||
    !Number.isSafeInteger(input.catalogEntry.expectedBytes) ||
    input.catalogEntry.expectedBytes < 5 ||
    typeof input.pdfPath !== "string" ||
    typeof input.model !== "string" ||
    input.model.trim().length === 0 ||
    typeof input.detect !== "function" ||
    typeof input.solve !== "function"
  ) {
    fail("INVALID_INPUT");
  }
}

export async function ingestExercisesFromPdf(
  input: ExerciseIngestionInput
): Promise<ExerciseIngestionResult> {
  validateInput(input);
  const generatedAt = (input.now ?? (() => new Date()))().toISOString();
  if (!Number.isFinite(Date.parse(generatedAt))) {
    fail("INVALID_INPUT");
  }

  const renderer = await (input.openRenderer ?? openPdfPageRenderer)({
    pdfPath: input.pdfPath,
    expectedSha256: input.catalogEntry.expectedSha256,
    expectedPageCount: input.catalogEntry.pages,
    expectedBytes: input.catalogEntry.expectedBytes,
    maxDimension: 1_600,
    jpegQuality: 90
  });

  const detected: Candidate[] = [];
  const pageReviewObservations = new Map<
    number,
    ExercisePageReviewStatus[]
  >();
  const issues: ExerciseIngestionIssue[] = [];
  try {
    let overlapCache = new Map<number, RenderedPdfPage>();
    for (const pages of buildOverlappingPageWindows(renderer.pageCount)) {
      const missing = pages.filter((page) => !overlapCache.has(page));
      const newlyRendered = missing.length
        ? await renderer.renderPages(missing)
        : [];
      const imagesByPage = new Map([
        ...overlapCache,
        ...newlyRendered.map((image) => [image.page, image] as const)
      ]);
      const images = pages.map((page) => {
        const image = imagesByPage.get(page);
        if (!image) {
          fail("DETECTION_FAILED");
        }
        return image;
      });

      let result: ExerciseDetectionResult;
      try {
        result = await input.detect(images);
      } catch {
        fail("DETECTION_FAILED");
      }
      const normalized = normalizeDetection(result, pages);
      if (
        detected.length + normalized.candidates.length >
        MAX_DETECTED_CANDIDATES
      ) {
        fail("BUDGET_EXCEEDED");
      }
      detected.push(...normalized.candidates);
      for (const reviewedPage of normalized.pagesReviewed) {
        const observations =
          pageReviewObservations.get(reviewedPage.page) ?? [];
        observations.push(reviewedPage.status);
        pageReviewObservations.set(reviewedPage.page, observations);
      }
      const overlapPage = pages.at(-1) as number;
      overlapCache = new Map([
        [overlapPage, imagesByPage.get(overlapPage) as RenderedPdfPage]
      ]);
    }

    const groups = groupCandidates(detected);
    const coverage = buildIngestionCoverage(
      renderer.pageCount,
      pageReviewObservations,
      groups
    );
    const classifyPage =
      input.pageActivity ?? getAuthoringPageActivity;
    const classified = groups
      .map((group) => {
        const classification = classifyGroup(
          input.catalogEntry.id,
          group,
          classifyPage
        );
        if (!classification.ok) {
          issues.push({
            code: classification.code,
            candidateId: group.candidateIds[0]
          });
          return null;
        }
        const pages = new Set(group.regions.map((region) => region.page));
        if (pages.size > MAX_EXERCISE_PAGES) {
          issues.push({
            code: "candidate-too-many-pages",
            candidateId: group.candidateIds[0]
          });
          return null;
        }
        if (group.confidence < LOW_CONFIDENCE) {
          issues.push({
            code: "candidate-low-confidence",
            candidateId: group.candidateIds[0]
          });
        }
        return {
          group,
          exercise: publicExercise({
            bookId: input.catalogEntry.id,
            group,
            unitId: classification.unitId,
            stage: classification.stage
          })
        };
      })
      .filter(
        (
          item
        ): item is { group: CandidateGroup; exercise: PublicExercise } =>
          item !== null
      );

    const uniqueClassified: typeof classified = [];
    const exerciseIds = new Set<string>();
    for (const item of classified) {
      if (exerciseIds.has(item.exercise.id)) {
        continue;
      }
      exerciseIds.add(item.exercise.id);
      uniqueClassified.push(item);
    }
    if (uniqueClassified.length > MAX_SOLUTION_CALLS) {
      fail("BUDGET_EXCEEDED");
    }

    const publicExercises: PublicExercise[] = [];
    const privateSolutions: PrivateExerciseSolutionsManifest["solutions"][number][] =
      [];
    for (const item of uniqueClassified) {
      const pages = [
        ...new Set(item.exercise.regions.map((region) => region.page))
      ];
      const images = await renderer.renderPages(pages);
      let solution: ExerciseSolution;
      try {
        solution = await input.solve({
          exerciseId: item.exercise.id,
          context: solutionContext(item.exercise, item.group.kind),
          images
        });
      } catch {
        fail("SOLUTION_FAILED");
      }

      if (solution.confidence < LOW_CONFIDENCE) {
        issues.push({
          code: "solution-low-confidence",
          candidateId: item.group.candidateIds[0]
        });
      }
      publicExercises.push(item.exercise);
      privateSolutions.push({
        exerciseId: item.exercise.id,
        revision: item.exercise.revision,
        reviewed: false,
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
      });
    }

    const publicManifest: PublicExerciseManifest = {
      schemaVersion: EXERCISE_MANIFEST_SCHEMA_VERSION,
      bookId: input.catalogEntry.id,
      sourceSha256: input.catalogEntry.expectedSha256,
      pageCount: input.catalogEntry.pages,
      coordinateSpace: EXERCISE_COORDINATE_SPACE,
      renderVersion: PDF_RENDER_VERSION,
      model: input.model.trim(),
      generatedAt,
      exercises: publicExercises
    };
    const privateManifest: PrivateExerciseSolutionsManifest = {
      schemaVersion: EXERCISE_MANIFEST_SCHEMA_VERSION,
      bookId: input.catalogEntry.id,
      sourceSha256: input.catalogEntry.expectedSha256,
      model: input.model.trim(),
      generatedAt,
      solutions: privateSolutions
    };

    const manifestIssues = validateExerciseManifests(
      publicManifest,
      privateManifest,
      {
        catalogEntries: [input.catalogEntry],
        pageActivity: classifyPage
      }
    );
    if (manifestIssues.length > 0) {
      fail("MANIFEST_INVALID");
    }
    return { publicManifest, privateManifest, coverage, issues };
  } finally {
    await renderer.close();
  }
}
