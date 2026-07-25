import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "AImauta — Aprende pensando",
    template: "%s | AImauta",
  },
  description:
    "Un espacio de aprendizaje guiado para explorar materiales escolares y construir tus propias respuestas.",
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
