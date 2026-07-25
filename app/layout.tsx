import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

// Absolute base for social previews. Links are shared mostly over WhatsApp,
// which resolves og:image against this origin rather than the current request.
//
// Reads the same AIMAUTA_PUBLIC_URL that assignment share links use, but
// degrades to a placeholder instead of throwing: a missing origin should cost
// a correct preview image, never a failed render of the page itself.
const siteUrl = resolveSiteUrl();

function resolveSiteUrl(): string {
  const configured = process.env.AIMAUTA_PUBLIC_URL?.trim();
  if (!configured) {
    return "https://aimauta.pe";
  }
  try {
    return new URL(configured).origin;
  } catch {
    return "https://aimauta.pe";
  }
}

const description =
  "Tutoría guiada sobre materiales oficiales del MINEDU. AImauta parte de tu intento, orienta con preguntas y pistas graduales, y muestra la fuente de cada explicación.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "AImauta — Aprende pensando",
    template: "%s | AImauta",
  },
  description,
  applicationName: "AImauta",
  openGraph: {
    type: "website",
    locale: "es_PE",
    siteName: "AImauta",
    title: "AImauta — No hace tu tarea. Te ayuda a entenderla.",
    description,
    url: siteUrl,
  },
  twitter: {
    card: "summary_large_image",
    title: "AImauta — No hace tu tarea. Te ayuda a entenderla.",
    description,
  },
  icons: {
    icon: [
      {
        url: "/brand/amauta-icon.svg",
        type: "image/svg+xml",
      },
    ],
    shortcut: "/brand/amauta-icon.svg",
    apple: "/brand/amauta-apple-touch.png",
  },
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="es">
      <body>
        <a className="skip-link" href="#contenido-principal">
          Saltar al contenido
        </a>
        {children}
      </body>
    </html>
  );
}
