"use client";

import type { ExerciseRegion } from "@/lib/exercise-manifest";
import type {
  PageExercise,
  PageExerciseOrigin,
} from "@/lib/page-exercises-response";

import styles from "@/components/exercise-overlay-layer.module.css";

export type ExerciseSelection = {
  exerciseId: string;
  exerciseRevision: number;
  origin: PageExerciseOrigin;
  regionId: string;
  page: number;
};

export type ExerciseOverlayState = "loading" | "ready" | "error";

type ExerciseOverlayLayerProps = {
  exercises?: readonly PageExercise[];
  page: number;
  selected?: ExerciseSelection | null;
  overlayState?: ExerciseOverlayState;
  onExerciseSelect?: (selection: ExerciseSelection) => void;
};

type PageExerciseRegion = {
  exercise: PageExercise;
  region: ExerciseRegion;
};

function isRenderableRegion(region: ExerciseRegion): boolean {
  const { x, y, width, height } = region.rect;
  return (
    Number.isFinite(x) &&
    Number.isFinite(y) &&
    Number.isFinite(width) &&
    Number.isFinite(height) &&
    x >= 0 &&
    y >= 0 &&
    width > 0 &&
    height > 0 &&
    x + width <= 1 &&
    y + height <= 1
  );
}

function percent(value: number): string {
  return `${value * 100}%`;
}

function regionLabel(
  exercise: PageExercise,
  region: ExerciseRegion,
): string {
  const title = exercise.title?.trim();
  const name = title ? `${exercise.label}: ${title}` : exercise.label;
  const source =
    exercise.origin === "rag-index"
      ? "actividad detectada en"
      : "ejercicio revisado de";
  return `Seleccionar ${name}, ${source} la página ${region.page}`;
}

export function ExerciseOverlayLayer({
  exercises = [],
  page,
  selected = null,
  overlayState = "ready",
  onExerciseSelect,
}: ExerciseOverlayLayerProps) {
  if (overlayState !== "ready") {
    return null;
  }

  const pageRegions: PageExerciseRegion[] = exercises
    .filter(
      (exercise) =>
        exercise.status === "published" || exercise.status === "detected",
    )
    .flatMap((exercise) =>
      exercise.regions
        .filter((region) => region.page === page && isRenderableRegion(region))
        .map((region) => ({ exercise, region })),
    );

  if (pageRegions.length === 0) {
    return null;
  }

  return (
    <div
      className={styles.layer}
      role="group"
      aria-label={`Ejercicios detectados en la página ${page}`}
    >
      {pageRegions.map(({ exercise, region }) => {
        const selection: ExerciseSelection = {
          exerciseId: exercise.id,
          exerciseRevision: exercise.revision,
          origin: exercise.origin,
          regionId: region.id,
          page: region.page,
        };
        const selectedExercise =
          selected?.exerciseId === exercise.id &&
          selected.exerciseRevision === exercise.revision;
        const selectedRegion =
          selectedExercise &&
          selected?.regionId === region.id &&
          selected?.page === region.page;

        return (
          <div
            className={`${styles.region} ${
              exercise.origin === "rag-index" ? styles.ragRegion : ""
            } ${
              selectedExercise ? styles.selectedRegion : ""
            }`}
            key={`${exercise.id}:${region.id}`}
            style={{
              left: percent(region.rect.x),
              top: percent(region.rect.y),
              width: percent(region.rect.width),
              height: percent(region.rect.height),
            }}
            data-region-role={region.role}
            data-exercise-origin={exercise.origin}
          >
            <button
              className={styles.trigger}
              type="button"
              onClick={() => onExerciseSelect?.(selection)}
              disabled={!onExerciseSelect}
              aria-label={regionLabel(exercise, region)}
              aria-pressed={selectedRegion}
              title={exercise.title || exercise.label}
            >
              {exercise.label}
            </button>
          </div>
        );
      })}
    </div>
  );
}
