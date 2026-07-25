import type { Metadata } from "next";
import Link from "next/link";

import { BrandMark } from "@/components/brand-mark";

export const metadata: Metadata = {
  title: "Términos de uso",
  description:
    "Condiciones de uso de AImauta: naturaleza del servicio, relación con los materiales oficiales, límites pedagógicos y responsabilidades.",
};

export default function TerminosPage() {
  return (
    <main id="contenido-principal" className="legal-page">
      <nav className="topbar shell" aria-label="Navegación principal">
        <Link className="brand" href="/" aria-label="AImauta, inicio">
          <BrandMark />
          <span>AImauta</span>
        </Link>
        <Link className="quiet-link" href="/">
          Volver al inicio
        </Link>
      </nav>

      <article className="legal-shell">
        <header className="legal-header">
          <p className="eyebrow">Legal</p>
          <h1>Términos de uso</h1>
          <p className="legal-updated">
            Última actualización: 25 de julio de 2026 · Versión piloto
          </p>
        </header>

        <div className="legal-content">
          <section>
            <h2>1. Qué es AImauta</h2>
            <p>
              AImauta es una plataforma web de acompañamiento pedagógico que
              ayuda a estudiantes de educación básica a resolver actividades
              por sí mismos. A partir del intento que el estudiante escribe, la
              plataforma responde con preguntas y pistas graduales referidas al
              material que está trabajando, e indica la página de origen de cada
              orientación.
            </p>
            <p>
              Este servicio se encuentra en fase de piloto. Su alcance,
              funciones y disponibilidad pueden cambiar sin previo aviso.
            </p>
          </section>

          <section>
            <h2>2. Relación con el Ministerio de Educación</h2>
            <div className="legal-callout">
              <p>
                AImauta es un proyecto independiente. No es una plataforma
                oficial del Ministerio de Educación del Perú (MINEDU), no ha
                sido desarrollada por encargo suyo y no cuenta con su aval,
                convenio, patrocinio ni certificación.
              </p>
            </div>
            <p>
              La plataforma utiliza materiales educativos difundidos por el
              MINEDU a través de sus repositorios institucionales públicos,
              citando en todo momento su procedencia. Cualquier mención al
              MINEDU o a sus materiales tiene como único fin identificar la
              fuente del contenido y no debe interpretarse como una relación
              institucional entre AImauta y dicha entidad.
            </p>
          </section>

          <section>
            <h2>3. Materiales educativos y derechos de terceros</h2>
            <p>
              Los materiales mostrados en la plataforma pertenecen a sus
              autores y titulares de derechos. AImauta documenta, para cada
              material incorporado, su fuente, edición, procedencia y
              condiciones de uso conocidas.
            </p>
            <p>
              AImauta no comercializa los materiales ni reclama titularidad
              sobre ellos. Si usted es titular de derechos sobre un contenido
              publicado en la plataforma y considera que su inclusión no
              corresponde, puede solicitar su retiro escribiendo a la dirección
              indicada en la sección de contacto; el material será retirado
              mientras se revisa la solicitud.
            </p>
          </section>

          <section>
            <h2>4. Cómo debe usarse el tutor</h2>
            <p>
              AImauta está diseñada para acompañar el razonamiento del
              estudiante, no para sustituirlo. En consecuencia:
            </p>
            <ul>
              <li>
                El tutor no entrega la respuesta de forma inmediata. Comienza
                por preguntas orientadas al intento del estudiante.
              </li>
              <li>
                La conversación está limitada al ejercicio, al material y al
                objetivo pedagógico correspondiente. No es un asistente de
                propósito general.
              </li>
              <li>
                Durante las secciones de evaluación, la asistencia del tutor y
                la consulta al material se desactivan. Esta restricción se
                aplica también en el servidor y no depende de la interfaz.
              </li>
            </ul>
            <p>
              El uso de la plataforma para resolver exámenes, suplantar el
              trabajo de un estudiante o eludir una evaluación contraviene su
              finalidad y puede motivar la suspensión del acceso.
            </p>
          </section>

          <section>
            <h2>5. Límites del servicio</h2>
            <p>
              Las orientaciones se generan mediante sistemas automatizados y
              pueden contener errores, aun cuando citen una fuente. Que una
              respuesta indique su procedencia no garantiza que sea correcta ni
              adecuada para todos los casos.
            </p>
            <p>
              AImauta no promete ni garantiza mejoras en las calificaciones,
              resultados académicos determinados ni aprendizaje personalizado.
              La plataforma adapta su orientación al intento escrito por el
              estudiante; cualquier afirmación sobre impacto educativo requerirá
              evidencia obtenida en pilotos evaluados.
            </p>
            <p>
              El servicio se ofrece &laquo;tal cual&raquo;, sin garantías de
              disponibilidad continua, ausencia de errores o idoneidad para un
              fin específico.
            </p>
          </section>

          <section>
            <h2>6. El rol del docente y de la familia</h2>
            <p>
              AImauta no reemplaza al docente ni a la familia: extiende su
              capacidad de acompañar. El criterio pedagógico, la evaluación
              formal y las decisiones sobre el aprendizaje de un estudiante
              corresponden siempre a las personas responsables de su educación.
            </p>
            <p>
              Los docentes que utilicen la plataforma para asignar actividades
              conservan la facultad de revisar los contenidos, desactivar
              ejercicios y controlar las tareas asignadas a su aula.
            </p>
          </section>

          <section>
            <h2>7. Situaciones que exceden el ámbito educativo</h2>
            <p>
              AImauta no brinda orientación psicológica, social, legal ni
              familiar, y no constituye un canal de emergencia. Si un estudiante
              comunica una situación de violencia, riesgo o desprotección, la
              plataforma no la tratará como una conversación educativa ordinaria
              y aplicará un protocolo de derivación hacia los canales de
              atención competentes.
            </p>
            <p>
              Ante una situación de peligro inmediato, comuníquese con los
              servicios de emergencia o con la Línea 100 del Ministerio de la
              Mujer y Poblaciones Vulnerables.
            </p>
          </section>

          <section>
            <h2>8. Acceso de estudiantes menores de edad</h2>
            <p>
              El acceso a una actividad no exige la creación de una cuenta ni
              la entrega de datos identificatorios del estudiante. La
              información personal que se solicita se limita a lo estrictamente
              necesario para el funcionamiento educativo, conforme se detalla en
              la <Link href="/privacidad">política de privacidad</Link>.
            </p>
            <p>
              Cuando una institución educativa o una familia habilite el uso de
              la plataforma por parte de un menor, corresponde a dicha
              institución o a quien ejerza la patria potestad verificar que ese
              uso resulta adecuado y cuenta con las autorizaciones exigidas por
              la normativa aplicable.
            </p>
          </section>

          <section>
            <h2>9. Modificaciones</h2>
            <p>
              Estos términos pueden actualizarse a medida que el piloto avance.
              La fecha de última actualización se indica al inicio de esta
              página. El uso continuado de la plataforma tras una modificación
              supone la aceptación de la versión vigente.
            </p>
          </section>

          <section>
            <h2>10. Contacto</h2>
            <p>
              Para consultas sobre estos términos, solicitudes relativas a
              derechos sobre materiales o cualquier otra comunicación, escriba a{" "}
              <a href="mailto:contacto@aimauta.pe">contacto@aimauta.pe</a>.
            </p>
          </section>
        </div>
      </article>

      <footer className="site-footer shell">
        <div className="footer-bottom">
          <p className="footer-disclaimer">
            Proyecto independiente. No es una plataforma oficial del MINEDU ni
            cuenta con su aval o patrocinio.
          </p>
          <nav className="footer-links" aria-label="Enlaces legales">
            <Link href="/">Inicio</Link>
            <Link href="/privacidad">Privacidad y datos</Link>
          </nav>
        </div>
      </footer>
    </main>
  );
}
