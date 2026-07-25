import type { Metadata } from "next";
import Link from "next/link";

import { BrandMark } from "@/components/brand-mark";

export const metadata: Metadata = {
  title: "Privacidad y datos",
  description:
    "Qué datos recoge AImauta, qué nunca solicita, cuánto tiempo los conserva y quién puede verlos. Principio de datos mínimos para estudiantes menores de edad.",
};

export default function PrivacidadPage() {
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
          <h1>Privacidad y datos</h1>
          <p className="legal-updated">
            Última actualización: 25 de julio de 2026 · Versión piloto
          </p>
        </header>

        <div className="legal-content">
          <section>
            <h2>1. El principio que nos guía</h2>
            <div className="legal-callout">
              <p>
                AImauta trabaja con estudiantes menores de edad. Por eso
                recogemos la menor cantidad de datos posible, durante el menor
                tiempo posible, y solo cuando cumplen una finalidad educativa
                concreta.
              </p>
            </div>
            <p>
              No almacenamos información &laquo;por si acaso&raquo;. Si un dato
              no responde a una necesidad pedagógica identificada, no se
              solicita ni se conserva.
            </p>
          </section>

          <section>
            <h2>2. Qué nunca pedimos a un estudiante</h2>
            <p>
              Para realizar una actividad, la plataforma no solicita ninguno de
              los siguientes datos:
            </p>
            <ul className="legal-negatives">
              <li>Documento Nacional de Identidad</li>
              <li>Dirección domiciliaria</li>
              <li>Número telefónico</li>
              <li>Fecha completa de nacimiento</li>
              <li>Fotografía del rostro</li>
              <li>Correo electrónico personal del menor</li>
            </ul>
            <p>
              Para identificar un trabajo dentro de un aula basta con un alias,
              un código de estudiante o un número de lista asignado por el
              docente.
            </p>
          </section>

          <section>
            <h2>3. Qué datos sí tratamos</h2>
            <ul>
              <li>
                <strong>Identificador de actividad.</strong> Un alias o código
                que permite al docente reconocer el trabajo dentro de su aula.
              </li>
              <li>
                <strong>Intentos y respuestas del ejercicio.</strong> Lo que el
                estudiante escribe al resolver la actividad, necesario para que
                el tutor pueda orientarlo.
              </li>
              <li>
                <strong>Datos de progreso.</strong> Número de intentos, pistas
                utilizadas, nivel de autonomía alcanzado y tiempo de trabajo.
              </li>
              <li>
                <strong>Datos técnicos mínimos de sesión.</strong> Un token
                anónimo de sesión que permite continuar la actividad sin
                registrar una cuenta.
              </li>
            </ul>
          </section>

          <section>
            <h2>4. Enlaces y códigos QR</h2>
            <p>
              Los códigos QR y enlaces que un docente comparte para asignar una
              actividad no contienen datos personales del estudiante. Contienen
              únicamente un token aleatorio que identifica la tarea.
            </p>
            <p>
              Estos tokens tienen vigencia limitada, pueden expirar y otorgan
              permisos acotados a la actividad correspondiente.
            </p>
          </section>

          <section>
            <h2>5. Quién puede ver el progreso</h2>
            <p>
              El desempeño de un estudiante no es público. Un enlace compartido
              no revela conversaciones completas, errores detallados,
              comparaciones con compañeros ni diagnósticos de aprendizaje.
            </p>
            <p>
              El detalle pedagógico está disponible para el docente responsable
              de la actividad y, cuando corresponda, para quien ejerza la patria
              potestad del estudiante. Los comprobantes de finalización muestran
              solo la información necesaria y comprensible para confirmar que la
              actividad se realizó.
            </p>
          </section>

          <section>
            <h2>6. Cómo presentamos los resultados</h2>
            <p>
              AImauta no clasifica ni etiqueta a los estudiantes. No emitimos
              categorías como &laquo;bajo rendimiento&raquo;, &laquo;alumno
              lento&raquo; o &laquo;riesgo alto&raquo;.
            </p>
            <p>
              La información se presenta en forma de observaciones accionables
              referidas a una dificultad concreta y a un momento determinado,
              orientadas a decidir qué conviene reforzar. El panel del docente
              responde preguntas pedagógicas —dónde se atascó el aula, qué
              pistas funcionaron, qué ejercicio conviene revisar en clase— y no
              está concebido como un mecanismo de vigilancia del comportamiento
              del estudiante.
            </p>
          </section>

          <section>
            <h2>7. Conservación</h2>
            <p>
              Los datos de una actividad se conservan durante el periodo lectivo
              en que fue asignada y por un plazo razonable posterior que permita
              al docente cerrar su evaluación. Cumplido ese plazo, la
              información se elimina o se anonimiza de forma irreversible.
            </p>
            <p>
              No conservamos de manera indefinida conversaciones completas,
              audios, imágenes ni datos de navegación.
            </p>
          </section>

          <section>
            <h2>8. Entrenamiento de modelos</h2>
            <div className="legal-callout">
              <p>
                Las interacciones de estudiantes menores de edad no se utilizan
                para entrenar ni mejorar modelos de inteligencia artificial.
              </p>
            </div>
            <p>
              Si en el futuro se contemplara un uso de esta naturaleza,
              requeriría un mecanismo explícito, informado y jurídicamente
              adecuado, y nunca operaría de forma predeterminada.
            </p>
          </section>

          <section>
            <h2>9. Marco normativo y derechos</h2>
            <p>
              El tratamiento de datos personales se rige por la Ley N.º 29733,
              Ley de Protección de Datos Personales, y su reglamento. El
              tratamiento de datos de menores de edad requiere el consentimiento
              de quien ejerza la patria potestad o tutela, en los términos
              previstos por dicha normativa.
            </p>
            <p>
              Los titulares de los datos —o sus representantes legales— pueden
              ejercer sus derechos de acceso, rectificación, cancelación y
              oposición escribiendo a la dirección indicada a continuación.
            </p>
          </section>

          <section>
            <h2>10. Contacto</h2>
            <p>
              Para consultas sobre privacidad, solicitudes de eliminación de
              datos o ejercicio de derechos, escriba a{" "}
              <a href="mailto:privacidad@aimauta.pe">privacidad@aimauta.pe</a>.
            </p>
            <p>
              Consulte también los{" "}
              <Link href="/terminos">términos de uso</Link> de la plataforma.
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
            <Link href="/terminos">Términos de uso</Link>
          </nav>
        </div>
      </footer>
    </main>
  );
}
