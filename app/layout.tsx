import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "AImauta — Aprende pensando",
    template: "%s | AImauta",
  },
  description:
    "Tutoría guiada sobre materiales oficiales del MINEDU. AImauta parte de tu intento, orienta con preguntas y pistas graduales, y muestra la fuente de cada explicación.",
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
