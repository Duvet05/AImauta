import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { LearningWorkspace } from "@/components/learning-workspace";
import { getBook } from "@/lib/catalog";

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
  const { bookId } = await params;
  const book = await getBook(bookId);

  if (!book) {
    notFound();
  }

  return (
    <main id="contenido-principal" className="workspace-page">
      <LearningWorkspace book={book} />
    </main>
  );
}
