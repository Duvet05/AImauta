import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { LearningWorkspace } from "@/components/learning-workspace";
import { getBook } from "@/lib/catalog";
import {
  getBookUnits,
  getFirstTutorablePage,
} from "@/lib/curriculum";
import { isVoiceTutorEnabled } from "@/lib/feature-flags";

type LearningPageProps = {
  params: Promise<{ bookId: string }>;
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

export default async function LearningPage({ params }: LearningPageProps) {
  await connection();
  const { bookId } = await params;
  const book = await getBook(bookId);

  if (!book) {
    notFound();
  }

  const firstPage = Math.min(
    getFirstTutorablePage(book.id) ?? 1,
    book.pages,
  );

  return (
    <main id="contenido-principal" className="workspace-page">
      <LearningWorkspace
        book={book}
        firstPage={firstPage}
        units={getBookUnits(book.id)}
        voiceTutorEnabled={isVoiceTutorEnabled()}
      />
    </main>
  );
}
