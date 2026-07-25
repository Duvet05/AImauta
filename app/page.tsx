import Image from "next/image";
import Link from "next/link";

import { BrandMark } from "@/components/brand-mark";
import { CatalogLibrary } from "@/components/catalog-library";
import { FooterQuipus } from "@/components/footer-quipus";
import { getBooks } from "@/lib/catalog";

const learningJourney = [
  {
    title: "Intenta",
    description:
      "Abre la ficha y explica qué entendiste o dónde te trabaste.",
    image: "/svg/amauta-thinks.svg",
  },
  {
    title: "Consulta",
    description:
      "AImauta recupera evidencia de la página exacta del cuaderno.",
    image: "/svg/amauta-points.svg",
  },
  {
    title: "Recibe una pista",
    description:
      "Obtienes una pregunta breve y gradual, siempre con su fuente.",
    image: "/svg/amauta-hint.svg",
  },
  {
    title: "Resuelve",
    description:
      "Vuelves al ejercicio y llegas a la respuesta por tu cuenta.",
    image: "/svg/amauta-celebrates.svg",
  },
] as const;

export default async function CatalogPage() {
  const books = await getBooks();

  return (
    <main id="contenido-principal">
      <section className="catalog-hero">
        <div className="hero-quipu" aria-hidden="true">
          <Image
            src="/svg/quipu.svg"
            alt=""
            fill
            sizes="(max-width: 680px) 250px, 30vw"
            unoptimized
          />
        </div>

        <nav className="topbar shell" aria-label="Navegación principal">
          <Link className="brand" href="/" aria-label="AImauta, inicio">
            <Image
              className="brand-primary-logo"
              src="/brand/ASD.png"
              alt=""
              width={924}
              height={232}
              priority
              unoptimized
            />
            <span className="sr-only">AImauta</span>
          </Link>
          <a className="quiet-link" href="#biblioteca">
            Ver cuadernos
          </a>
        </nav>

        <div className="hero-content shell">
          <div className="hero-copy">
            <p className="eyebrow">Tutoría guiada · Matemática de secundaria</p>
            <h1>
              No hace tu tarea.
              <span> Te ayuda a entenderla.</span>
            </h1>
            <p className="hero-lead">
              Abre un cuaderno oficial del MINEDU, intenta el ejercicio y cuenta
              qué pensaste. AImauta parte de tu intento y responde con preguntas
              y pistas graduales —nunca con la respuesta hecha—, y siempre te
              muestra la página del material de donde salió cada una.
            </p>
            <a className="primary-action" href="#biblioteca">
              Elegir un cuaderno
              <ArrowIcon />
            </a>
            <p className="pilot-boundary">
              Cuando llegas a una sección de evaluación, el tutor se apaga solo.
              Esas respuestas son tuyas.
            </p>
          </div>

          <div className="hero-demo" aria-label="Ejemplo de una pista con fuente">
            <div className="demo-orbit demo-orbit-one" aria-hidden="true" />
            <div className="demo-orbit demo-orbit-two" aria-hidden="true" />
            <div className="demo-card">
              <div className="demo-card-top">
                <span className="avatar avatar-tutor">AI</span>
                <div>
                  <strong>Pista de AImauta</strong>
                  <small>Fuente: cuaderno, pág. 13</small>
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
            <div className="hero-amauta-guide" aria-hidden="true">
              <Image
                src="/svg/amauta-points.svg"
                alt=""
                fill
                sizes="(max-width: 980px) 0px, 220px"
                unoptimized
              />
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

      <section className="problem-section shell" aria-labelledby="problema">
        <div className="problem-copy">
          <p className="eyebrow">El problema</p>
          <h2 id="problema">
            Un material disponible no es lo mismo que un estudiante
            acompañado.
          </h2>
        </div>
        <div className="problem-body">
          <p>
            El Perú produce materiales educativos de gran valor. Pero entregar
            un libro o publicar un PDF no garantiza que un estudiante pueda
            comprenderlo y usarlo por su cuenta.
          </p>
          <p>
            Cuando se atasca, casi siempre necesita lo mismo: que alguien le
            haga la pregunta adecuada. Qué datos reconoce, qué ya intentó, qué
            relación encuentra, por qué eligió esa estrategia.
          </p>
          <p>
            El docente no puede acompañar individualmente a toda su aula al
            mismo tiempo, y muchas familias no cuentan con el tiempo o los
            conocimientos para hacerlo en casa.
          </p>
          <p className="problem-turn">AImauta nace para cubrir ese espacio.</p>
        </div>
      </section>

      <section
        className="learning-journey-section"
        aria-labelledby="como-funciona"
      >
        <div className="learning-journey-shell shell">
          <div className="learning-journey-heading">
            <div>
              <p className="eyebrow">Cómo funciona</p>
              <h2 id="como-funciona">
                El estudiante piensa.
                <span> AImauta acompaña.</span>
              </h2>
            </div>
            <p>
              El acompañamiento sigue el ritmo natural del estudiante: parte de
              su intento, recupera evidencia y ofrece solo la ayuda necesaria
              para avanzar.
            </p>
          </div>

          <ol className="learning-journey-list">
            {learningJourney.map((step, index) => (
              <li className="learning-step" key={step.title}>
                <article className="learning-step-card">
                  <div className="learning-step-visual">
                    <span className="learning-step-number">
                      Paso {index + 1}
                    </span>
                    <Image
                      src={step.image}
                      alt=""
                      fill
                      sizes="(max-width: 680px) 112px, (max-width: 1100px) 42vw, 250px"
                      unoptimized
                    />
                  </div>
                  <div className="learning-step-copy">
                    <h3>{step.title}</h3>
                    <p>{step.description}</p>
                  </div>
                </article>
              </li>
            ))}
          </ol>

          <p className="learning-journey-promise">
            <span aria-hidden="true">✦</span>
            AImauta acompaña el proceso. La respuesta final sigue siendo del
            estudiante.
          </p>
        </div>
      </section>

      <section className="commitment-section shell" aria-labelledby="compromisos">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Cómo lo hacemos</p>
            <h2 id="compromisos">Cuatro compromisos</h2>
          </div>
        </div>
        <div className="commitment-grid">
          <article>
            <h3>Aprovecha lo que ya existe</h3>
            <p>
              Trabaja sobre materiales curriculares oficiales. No propone un
              currículo paralelo ni pide crear contenido desde cero.
            </p>
          </article>
          <article>
            <h3>Cada orientación tiene origen</h3>
            <p>
              Toda pista queda vinculada al material y la página que la
              respalda, y el estudiante puede abrirla para comprobarlo.
            </p>
          </article>
          <article>
            <h3>No funciona como solucionario</h3>
            <p>
              Empieza por preguntas. La respuesta completa no llega antes que
              el razonamiento del estudiante.
            </p>
          </article>
          <article>
            <h3>Genera evidencia útil</h3>
            <p>
              Registra intentos, pistas usadas y avance por objetivo: no solo
              si la actividad fue completada.
            </p>
          </article>
        </div>
      </section>

      <section className="library-section shell" id="biblioteca">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Empieza aquí</p>
            <h2>Cuadernos listos para trabajar</h2>
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

      <section className="teacher-section shell" aria-labelledby="docentes">
        <div className="teacher-copy">
          <p className="eyebrow eyebrow-pending">Backend QR en piloto</p>
          <h2 id="docentes">Para el aula</h2>
          <p className="teacher-lead">
            La integración docente ya puede seleccionar ejercicios, armar una
            tarea y compartirla con un enlace o un código QR. Sin instalar nada:
            el estudiante escanea y empieza. El panel visual para docentes sigue
            en desarrollo.
          </p>
          <p className="teacher-lead">
            El piloto conserva métricas anónimas por ejecución: objetivos
            completados, turnos, intentos y pista máxima. No guarda nombres,
            respuestas ni conversaciones del estudiante.
          </p>
          <p className="teacher-promise">
            AImauta no reemplaza al profesor. Extiende su capacidad de
            acompañar.
          </p>
        </div>
        <ul className="teacher-list">
          <li>Asignar fichas, páginas o ejercicios por enlace o QR</li>
          <li>Descargar el QR en SVG, PNG o PDF</li>
          <li>Revisar progreso agregado sin identificar estudiantes</li>
          <li>Rotar o revocar accesos cuando sea necesario</li>
        </ul>
      </section>

      <footer className="site-footer shell">
        <div className="footer-top">
          <Link
            className="brand brand-small"
            href="/"
            aria-label="AImauta, inicio"
          >
            <BrandMark />
            <span>AImauta</span>
          </Link>
          <p>
            AImauta convierte cada ejercicio en una conversación que enseña a
            pensar.
          </p>
        </div>
        <div className="footer-bottom">
          <p className="footer-disclaimer">
            Proyecto independiente. Utiliza materiales educativos del
            repositorio institucional del MINEDU citando su fuente. No es una
            plataforma oficial del MINEDU ni cuenta con su aval o patrocinio.
          </p>
          <nav className="footer-links" aria-label="Enlaces legales">
            <Link href="/terminos">Términos de uso</Link>
            <Link href="/privacidad">Privacidad y datos</Link>
          </nav>
        </div>
        <FooterQuipus />
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
