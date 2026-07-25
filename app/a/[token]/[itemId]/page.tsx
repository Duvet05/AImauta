import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { LearningWorkspace } from "@/components/learning-workspace";
import { getBook } from "@/lib/catalog";
import { getBookUnits } from "@/lib/curriculum";
import { resolvePublicAssignment } from "@/lib/assignment-service";
import {
  isAvatarEnabled,
  isVoiceTutorEnabled,
} from "@/lib/feature-flags";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Resolver actividad | AImauta",
  robots: { index: false, follow: false },
  referrer: "no-referrer"
};

type AssignmentItemPageProps = {
  params: Promise<{ token: string; itemId: string }>;
};

export default async function AssignmentItemPage({
  params
}: AssignmentItemPageProps) {
  await connection();
  const { token, itemId } = await params;
  const resolved = await resolvePublicAssignment(token).catch(() => null);
  const item = resolved?.public.items.find(
    (candidate) => candidate.id === itemId
  );
  const book = item ? getBook(item.bookId) : undefined;

  if (!resolved || !item || !book) {
    notFound();
  }

  return (
    <main id="contenido-principal" className="workspace-page">
      <LearningWorkspace
        assignmentLaunch={{
          publicToken: token,
          itemId: item.id,
          landingPath: `/a/${encodeURIComponent(token)}`,
          assignmentTitle: resolved.public.title
        }}
        avatarPreviewEnabled={isAvatarEnabled()}
        book={book}
        firstPage={item.pages[0]}
        units={getBookUnits(book.id)}
        voiceTutorEnabled={isVoiceTutorEnabled()}
      />
    </main>
  );
}
