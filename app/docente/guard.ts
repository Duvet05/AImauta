import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  isValidTeacherSession,
  teacherSessionCookieName,
  TeacherAuthConfigurationError,
} from "@/lib/teacher-session";

/**
 * Every panel page and action calls this before touching the database.
 *
 * Middleware cannot cover it: the cookie is signed with a Node crypto HMAC, and
 * the panel reads Prisma directly rather than going through the bearer-guarded
 * API. Checking here keeps the guard next to the data access it protects.
 *
 * Fails closed — a misconfigured secret redirects to the access screen instead
 * of leaving the class roster readable.
 */
export async function requireTeacherSession(): Promise<void> {
  const store = await cookies();
  const value = store.get(teacherSessionCookieName)?.value;

  try {
    if (!isValidTeacherSession(value)) {
      redirect("/docente/acceso");
    }
  } catch (error) {
    if (error instanceof TeacherAuthConfigurationError) {
      redirect("/docente/acceso?error=configuracion");
    }
    throw error;
  }
}
