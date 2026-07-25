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
              En el flujo QR actual tampoco se pide alias, código de estudiante
              ni número de lista. Cada ejecución usa únicamente un
              identificador técnico aleatorio.
            </p>
          </section>

          <section>
            <h2>3. Qué datos sí tratamos</h2>
            <ul>
              <li>
                <strong>Identificador de actividad.</strong> Un código aleatorio
                que vincula el enlace, la tarea y una ejecución anónima.
              </li>
              <li>
                <strong>Intentos y respuestas del ejercicio.</strong> Lo que el
                estudiante escribe al resolver la actividad, necesario para que
                el tutor pueda orientarlo. En el piloto QR este texto se procesa
                durante el turno, pero no se guarda en PostgreSQL.
              </li>
              <li>
                <strong>Datos de progreso.</strong> Estado de finalización,
                cantidad de turnos e intentos, pista máxima y marcas de tiempo.
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
              El enlace compartido no revela conversaciones, texto de intentos,
              errores detallados, comparaciones con compañeros ni diagnósticos
              de aprendizaje.
            </p>
            <p>
              La integración docente protegida muestra métricas por ejecución
              anónima y agregados por objetivo. Los comprobantes usan un enlace
              separado y muestran solo título, fecha y conteos necesarios para
              confirmar la finalización; no identifican a un estudiante.
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
              La integración piloto presenta conteos por objetivo y ejecución
              anónima. El futuro panel docente deberá convertir esos agregados
              en observaciones pedagógicas accionables y no en etiquetas,
              perfiles individuales ni mecanismos de vigilancia.
            </p>
          </section>

          <section>
            <h2>7. Conservación</h2>
            <p>
              El piloto conserva tareas y métricas anónimas hasta que el
              responsable las archive o elimine. Todavía no existe un proceso
              automático de retención; antes de operar con un centro educativo
              se debe acordar y configurar un plazo de eliminación.
            </p>
            <p>
              No conservamos de manera indefinida conversaciones completas,
              audios, imágenes ni datos de navegación.
            </p>
            <p>
              Para producir una pista, AImauta envía temporalmente al proveedor
              configurado —OpenAI, xAI o Google Gemini— el texto acotado de la
              pregunta, el intento y fragmentos del material curricular. No
              adjunta el token QR, el token firmado de sesión, notas ni
              identificadores del directorio escolar. Como el intento es texto
              libre, podría contener un dato personal que el propio estudiante
              escriba; se debe evitar incluirlo.
            </p>
            <p>
              Las solicitudes se realizan con almacenamiento de respuesta
              desactivado. Aun así, cada proveedor mantiene controles y
              retenciones independientes para seguridad y monitoreo de abuso.
              Un acuerdo o configuración de retención cero debe verificarse por
              separado antes de un piloto institucional.
              Consulte los{" "}
              <a href="https://developers.openai.com/api/docs/guides/your-data">
                controles de datos de OpenAI
              </a>{" "}
              y la{" "}
              <a href="https://docs.x.ai/developers/faq/security">
                información de seguridad de xAI
              </a>
              , y la{" "}
              <a href="https://ai.google.dev/gemini-api/docs/logs-policy">
                política de logs de Gemini
              </a>
              .
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
              Los servicios API configurados declaran que no entrenan sus
              modelos con entradas o salidas del cliente sin autorización
              explícita. AImauta no habilita ningún mecanismo de
              compartición voluntaria para entrenamiento. Si en el futuro se
              contemplara un uso de esta naturaleza, requeriría un mecanismo
              explícito, informado y jurídicamente adecuado, y nunca operaría
              de forma predeterminada.
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
