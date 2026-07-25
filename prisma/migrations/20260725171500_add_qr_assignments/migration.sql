-- CreateEnum
CREATE TYPE "AssignmentKind" AS ENUM ('TASK', 'WORKSHEET', 'PAGE', 'EXERCISE', 'REINFORCEMENT');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('ACTIVE', 'REVOKED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AssignmentItemKind" AS ENUM ('UNIT', 'PAGE', 'EXERCISE');

-- CreateEnum
CREATE TYPE "AssignmentRunStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED');

-- CreateEnum
CREATE TYPE "AssignmentItemProgressStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED');

-- CreateTable
CREATE TABLE "Assignment" (
    "id" TEXT NOT NULL,
    "publicTokenHash" TEXT NOT NULL,
    "publicTokenCiphertext" TEXT NOT NULL,
    "kind" "AssignmentKind" NOT NULL,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "title" TEXT NOT NULL,
    "instructions" TEXT,
    "teacherId" TEXT NOT NULL,
    "courseId" TEXT,
    "groupLabel" TEXT,
    "availableFrom" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "maxHintLevel" INTEGER NOT NULL DEFAULT 3,
    "requiredItemCount" INTEGER NOT NULL,
    "minimumTurnsPerItem" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Assignment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Assignment_schedule_check" CHECK (
      "availableFrom" IS NULL OR "availableFrom" < "expiresAt"
    ),
    CONSTRAINT "Assignment_hint_level_check" CHECK (
      "maxHintLevel" BETWEEN 0 AND 3
    ),
    CONSTRAINT "Assignment_completion_check" CHECK (
      "requiredItemCount" > 0 AND
      "minimumTurnsPerItem" BETWEEN 0 AND 40
    )
);

-- CreateTable
CREATE TABLE "AssignmentItem" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "kind" "AssignmentItemKind" NOT NULL,
    "bookId" TEXT NOT NULL,
    "bookSha256" TEXT NOT NULL,
    "curriculumVersion" TEXT NOT NULL,
    "unitId" TEXT,
    "pages" INTEGER[] NOT NULL,
    "exerciseId" TEXT,
    "exerciseRevision" INTEGER,
    "label" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssignmentItem_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AssignmentItem_position_check" CHECK ("position" >= 0),
    CONSTRAINT "AssignmentItem_pages_check" CHECK (
      cardinality("pages") > 0 AND
      0 < ALL ("pages")
    ),
    CONSTRAINT "AssignmentItem_exercise_check" CHECK (
      (
        "kind" = 'EXERCISE' AND
        "unitId" IS NOT NULL AND
        "exerciseId" IS NOT NULL AND
        "exerciseRevision" IS NOT NULL AND
        "exerciseRevision" > 0
      ) OR (
        "kind" = 'UNIT' AND
        "unitId" IS NOT NULL AND
        "exerciseId" IS NULL AND
        "exerciseRevision" IS NULL
      ) OR (
        "kind" = 'PAGE' AND
        "exerciseId" IS NULL AND
        "exerciseRevision" IS NULL
      )
    )
);

-- CreateTable
CREATE TABLE "AssignmentRun" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "resumeTokenHash" TEXT NOT NULL,
    "status" "AssignmentRunStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "receiptTokenHash" TEXT,
    "receiptTokenCiphertext" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "AssignmentRun_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AssignmentRun_receipt_check" CHECK (
      ("receiptTokenHash" IS NULL) = ("receiptTokenCiphertext" IS NULL)
    ),
    CONSTRAINT "AssignmentRun_completion_check" CHECK (
      (
        "status" = 'IN_PROGRESS' AND
        "completedAt" IS NULL
      ) OR (
        "status" = 'COMPLETED' AND
        "completedAt" IS NOT NULL AND
        "receiptTokenHash" IS NOT NULL
      )
    )
);

-- CreateTable
CREATE TABLE "AssignmentItemProgress" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "assignmentItemId" TEXT NOT NULL,
    "status" "AssignmentItemProgressStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "turnCount" INTEGER NOT NULL DEFAULT 0,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "hintLevel" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssignmentItemProgress_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AssignmentItemProgress_counts_check" CHECK (
      "turnCount" >= 0 AND
      "attemptCount" >= 0 AND
      "attemptCount" <= "turnCount" AND
      "hintLevel" BETWEEN 0 AND 3
    ),
    CONSTRAINT "AssignmentItemProgress_status_check" CHECK (
      (
        "status" = 'NOT_STARTED' AND
        "startedAt" IS NULL AND
        "completedAt" IS NULL
      ) OR (
        "status" = 'IN_PROGRESS' AND
        "startedAt" IS NOT NULL AND
        "completedAt" IS NULL
      ) OR (
        "status" = 'COMPLETED' AND
        "startedAt" IS NOT NULL AND
        "completedAt" IS NOT NULL
      )
    )
);

-- CreateIndex
CREATE UNIQUE INDEX "Assignment_publicTokenHash_key" ON "Assignment"("publicTokenHash");
CREATE INDEX "Assignment_teacherId_createdAt_idx" ON "Assignment"("teacherId", "createdAt");
CREATE INDEX "Assignment_courseId_idx" ON "Assignment"("courseId");
CREATE INDEX "Assignment_status_expiresAt_idx" ON "Assignment"("status", "expiresAt");

CREATE UNIQUE INDEX "AssignmentItem_assignmentId_position_key" ON "AssignmentItem"("assignmentId", "position");
CREATE UNIQUE INDEX "AssignmentItem_assignmentId_id_key" ON "AssignmentItem"("assignmentId", "id");
CREATE INDEX "AssignmentItem_bookId_idx" ON "AssignmentItem"("bookId");

CREATE UNIQUE INDEX "AssignmentRun_resumeTokenHash_key" ON "AssignmentRun"("resumeTokenHash");
CREATE UNIQUE INDEX "AssignmentRun_receiptTokenHash_key" ON "AssignmentRun"("receiptTokenHash");
CREATE UNIQUE INDEX "AssignmentRun_assignmentId_id_key" ON "AssignmentRun"("assignmentId", "id");
CREATE INDEX "AssignmentRun_assignmentId_startedAt_idx" ON "AssignmentRun"("assignmentId", "startedAt");
CREATE INDEX "AssignmentRun_status_lastActivityAt_idx" ON "AssignmentRun"("status", "lastActivityAt");

CREATE UNIQUE INDEX "AssignmentItemProgress_runId_assignmentItemId_key" ON "AssignmentItemProgress"("runId", "assignmentItemId");
CREATE INDEX "AssignmentItemProgress_assignmentId_assignmentItemId_idx" ON "AssignmentItemProgress"("assignmentId", "assignmentItemId");

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_teacherId_fkey"
  FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_courseId_fkey"
  FOREIGN KEY ("courseId") REFERENCES "Course"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AssignmentItem" ADD CONSTRAINT "AssignmentItem_assignmentId_fkey"
  FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AssignmentRun" ADD CONSTRAINT "AssignmentRun_assignmentId_fkey"
  FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AssignmentItemProgress" ADD CONSTRAINT "AssignmentItemProgress_assignmentId_runId_fkey"
  FOREIGN KEY ("assignmentId", "runId")
  REFERENCES "AssignmentRun"("assignmentId", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AssignmentItemProgress" ADD CONSTRAINT "AssignmentItemProgress_assignmentId_assignmentItemId_fkey"
  FOREIGN KEY ("assignmentId", "assignmentItemId")
  REFERENCES "AssignmentItem"("assignmentId", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;
