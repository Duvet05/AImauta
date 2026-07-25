import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { LearningWorkspace } from "@/components/learning-workspace";
import { getBook } from "@/lib/catalog";
import {
  getBookUnits,
  getFirstTutorablePage,
} from "@/lib/curriculum";
import {
  isAvatarEnabled,
  isAvatarPreviewRequested,
  isVoiceTutorEnabled,
} from "@/lib/feature-flags";

type LearningPageProps = {
  params: Promise<{ bookId: string }>;
  searchParams: Promise<{
    avatar?: string | string[];
  }>;
};

export async function generateMetadata({
  params,
}: LearningPageProps): Promise<Metadata> {
  const { bookId } = await params;
  const book = await getBook(bookId);

  return {
    title: book ? `Aprender con ${book.title}` : "Material no encontrado",
  };
}

export default async function LearningPage({
  params,
  searchParams,
}: LearningPageProps) {
  await connection();
  const [{ bookId }, query] = await Promise.all([params, searchParams]);
  const book = await getBook(bookId);

  if (!book) {
    notFound();
  }

  const firstPage = Math.min(
    getFirstTutorablePage(book.id) ?? 1,
    book.pages,
  );
  const avatarPreviewRequested = isAvatarPreviewRequested(query.avatar);
  const avatarPreviewEnabled =
    isAvatarEnabled() && avatarPreviewRequested;
  const voiceTutorEnabled =
    isVoiceTutorEnabled() && avatarPreviewRequested;

  return (
    <main
      id="contenido-principal"
      className="workspace-page"
      data-avatar-preview={
        avatarPreviewEnabled || voiceTutorEnabled ? "enabled" : "disabled"
      }
    >
      <LearningWorkspace
        avatarPreviewEnabled={avatarPreviewEnabled}
        book={book}
        firstPage={firstPage}
        units={getBookUnits(book.id)}
        voiceTutorEnabled={voiceTutorEnabled}
      />
    </main>
  );
}
