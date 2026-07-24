import Link from "next/link";

import { BrandMark } from "@/components/brand-mark";
import { CatalogLibrary } from "@/components/catalog-library";
import { getBooks } from "@/lib/catalog";

export default async function CatalogPage() {
  const books = await getBooks();

  return (
    <main id="contenido-principal">
      <section className="catalog-hero">
        <nav className="topbar shell" aria-label="Navegación principal">
          <Link className="brand" href="/" aria-label="AImauta, inicio">
            <BrandMark />
            <span>AImauta</span>
          </Link>
          <a className="quiet-link" href="#biblioteca">
            Probar el piloto
          </a>
        </nav>

        <div className="hero-content shell">
          <div className="hero-copy">
            <p className="eyebrow">Piloto RAG · Matemática secundaria</p>
            <h1>
              Lee una ficha, intenta resolverla
              <span> y recibe una pista con fuente.</span>
            </h1>
            <p className="hero-lead">
              Este piloto incluye dos cuadernos de Matemática del MINEDU para
              1.º y 2.º de secundaria. Abre una página de Construimos o
              Comprobamos, escribe qué intentaste y AImauta te dará una pista
              basada en el material, con la página citada.
            </p>
            <a className="primary-action" href="#biblioteca">
              Elegir un cuaderno
              <ArrowIcon />
            </a>
            <p className="pilot-boundary">
              En Orientación y Evaluamos no hay pistas ni consulta al material.
            </p>
          </div>

          <div className="hero-demo" aria-label="Ejemplo de una pista con fuente">
            <div className="demo-orbit demo-orbit-one" aria-hidden="true" />
            <div className="demo-orbit demo-orbit-two" aria-hidden="true" />
            <div className="demo-card">
              <div className="demo-card-top">
                <span className="avatar avatar-tutor">AI</span>
                <div>
                  <strong>Pista basada en la ficha</strong>
                  <small>Fuente: pág. 13</small>
                </div>
                <span className="status-dot" title="Disponible" />
              </div>
              <p>
                ¿Qué dato del problema crees que te ayuda más a comenzar y por
                qué?
              </p>
              <div className="thinking-steps" aria-hidden="true">
                <span className="step-complete">1</span>
                <i />
                <span className="step-active">2</span>
                <i />
                <span>3</span>
              </div>
            </div>
            <div className="demo-note demo-note-left" aria-hidden="true">
              <span>✦</span>
              <strong>Tu intento</strong>
            </div>
            <div className="demo-note demo-note-right" aria-hidden="true">
              <span>✓</span>
              <strong>Con fuente</strong>
            </div>
          </div>
        </div>
      </section>

      <section className="learning-principles shell" aria-label="Cómo funciona">
        <article>
          <span className="principle-number">01</span>
          <div>
            <h2>Abre una ficha</h2>
            <p>Elige Construimos o Comprobamos y lee el ejercicio en el PDF.</p>
          </div>
        </article>
        <article>
          <span className="principle-number">02</span>
          <div>
            <h2>Escribe tu intento</h2>
            <p>Escribe cómo lo resolverías, aunque todavía tengas dudas.</p>
          </div>
        </article>
        <article>
          <span className="principle-number">03</span>
          <div>
            <h2>Pide una pista y abre la cita</h2>
            <p>AImauta orienta sin resolver y muestra la página que consultó.</p>
          </div>
        </article>
      </section>

      <section className="library-section shell" id="biblioteca">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Piloto disponible</p>
            <h2>Matemática de 1.º y 2.º de secundaria</h2>
          </div>
          <p>
            {books.length}{" "}
            {books.length === 1
              ? "material disponible"
              : "materiales disponibles"}
          </p>
        </div>

        <CatalogLibrary books={books} />
      </section>

      <footer className="site-footer shell">
        <Link className="brand brand-small" href="/" aria-label="AImauta, inicio">
          <BrandMark />
          <span>AImauta</span>
        </Link>
        <p>Cada pista muestra de dónde sale.</p>
      </footer>
    </main>
  );
}

function ArrowIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <path d="M4 10h11M11 6l4 4-4 4" />
    </svg>
  );
}
