import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { BrandMark } from "@/components/brand-mark";
import {
  isValidTeacherSession,
  issueTeacherSession,
  matchesAdminSecret,
  teacherSessionCookieName,
  TeacherAuthConfigurationError,
} from "@/lib/teacher-session";

export const metadata: Metadata = {
  title: "Acceso docente",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AccesoPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const store = await cookies();
  if (isValidTeacherSession(store.get(teacherSessionCookieName)?.value)) {
    redirect("/docente");
  }

  async function signIn(formData: FormData) {
    "use server";

    const secret = formData.get("secret");
    if (typeof secret !== "string" || !secret) {
      redirect("/docente/acceso?error=vacio");
    }

    try {
      if (!matchesAdminSecret(secret)) {
        redirect("/docente/acceso?error=invalido");
      }
    } catch (cause) {
      if (cause instanceof TeacherAuthConfigurationError) {
        redirect("/docente/acceso?error=configuracion");
      }
      throw cause;
    }

    const session = issueTeacherSession();
    const store = await cookies();
    store.set(teacherSessionCookieName, session.value, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: session.maxAge,
    });
    redirect("/docente");
  }

  return (
    <main id="contenido-principal" className="access-page">
      <div className="access-card">
        <Link className="brand" href="/" aria-label="AImauta, inicio">
          <BrandMark />
          <span>AImauta</span>
        </Link>

        <h1>Acceso docente</h1>
        <p className="access-lead">
          Ingresa la clave de tu institución para ver tus cursos, el avance de
          tus estudiantes y las tareas que has asignado.
        </p>

        {error ? (
          <p className="access-error" role="alert">
            {errorMessage(error)}
          </p>
        ) : null}

        <form action={signIn} className="access-form">
          <label htmlFor="secret">Clave de la institución</label>
          <input
            id="secret"
            name="secret"
            type="password"
            autoComplete="current-password"
            required
          />
          <button type="submit">Entrar</button>
        </form>

        <p className="access-note">
          El acceso dura 8 horas. Esta clave es de la institución, no personal:
          no la compartas por mensajería.
        </p>
      </div>
    </main>
  );
}

function errorMessage(code: string): string {
  if (code === "configuracion") {
    return "El acceso docente no está configurado en este servidor. Avisa al equipo técnico.";
  }
  if (code === "vacio") {
    return "Escribe la clave para continuar.";
  }
  return "Esa clave no es correcta. Vuelve a intentarlo.";
}
