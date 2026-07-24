import Link from "next/link";

import { BookCard } from "@/components/book-card";
import { BrandMark } from "@/components/brand-mark";
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
            Explorar biblioteca
          </a>
        </nav>

        <div className="hero-content shell">
          <div className="hero-copy">
            <p className="eyebrow">Tu profesor para aprender pensando</p>
            <h1>
              Lee, intenta y descubre
              <span> el siguiente paso.</span>
            </h1>
            <p className="hero-lead">
              Trabaja con tus materiales escolares mientras un tutor te hace las
              preguntas correctas. Aquí la meta no es recibir una respuesta:
              es aprender a encontrarla.
            </p>
            <a className="primary-action" href="#biblioteca">
              Elegir un material
              <ArrowIcon />
            </a>
          </div>

          <div className="hero-demo" aria-label="Así te acompaña AImauta">
            <div className="demo-orbit demo-orbit-one" aria-hidden="true" />
            <div className="demo-orbit demo-orbit-two" aria-hidden="true" />
            <div className="demo-card">
              <div className="demo-card-top">
                <span className="avatar avatar-tutor">AI</span>
                <div>
                  <strong>Empecemos por tu idea</strong>
                  <small>Tutor guía</small>
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
              <strong>A tu ritmo</strong>
            </div>
            <div className="demo-note demo-note-right" aria-hidden="true">
              <span>✓</span>
              <strong>Con pistas</strong>
            </div>
          </div>
        </div>
      </section>

      <section className="learning-principles shell" aria-label="Cómo funciona">
        <article>
          <span className="principle-number">01</span>
          <div>
            <h2>Material a la vista</h2>
            <p>Lee el libro y mantén siempre el ejercicio en contexto.</p>
          </div>
        </article>
        <article>
          <span className="principle-number">02</span>
          <div>
            <h2>Tu intento primero</h2>
            <p>Escribe cómo lo resolverías, aunque todavía tengas dudas.</p>
          </div>
        </article>
        <article>
          <span className="principle-number">03</span>
          <div>
            <h2>Una pista a la vez</h2>
            <p>El tutor pregunta y orienta sin resolver el ejercicio por ti.</p>
          </div>
        </article>
      </section>

      <section className="library-section shell" id="biblioteca">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Biblioteca de aprendizaje</p>
            <h2>¿Qué quieres aprender hoy?</h2>
          </div>
          <p>
            {books.length} {books.length === 1 ? "material disponible" : "materiales disponibles"}
          </p>
        </div>

        {books.length > 0 ? (
          <div className="book-grid">
            {books.map((book, index) => (
              <BookCard book={book} index={index} key={book.id} />
            ))}
          </div>
        ) : (
          <div className="empty-library">
            <span aria-hidden="true">⌁</span>
            <h3>La biblioteca se está preparando</h3>
            <p>Vuelve pronto para comenzar con el primer material.</p>
          </div>
        )}
      </section>

      <footer className="site-footer shell">
        <Link className="brand brand-small" href="/" aria-label="AImauta, inicio">
          <BrandMark />
          <span>AImauta</span>
        </Link>
        <p>Aprender también es hacerse buenas preguntas.</p>
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
