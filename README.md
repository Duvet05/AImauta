<div align="center">

<img src="public/svg/amauta-thinks.svg" alt="Amauta, el tutor de AImauta, pensando" width="200" />

# AImauta

**Tutoría educativa con IA que enseña a pensar, no a copiar.**

_Un tutor socrático que parte del intento real del estudiante, orienta con pistas y siempre muestra la fuente._

<br />

![Licencia MIT](https://img.shields.io/badge/licencia-MIT-172d2a)
![Next.js](https://img.shields.io/badge/Next.js-App_Router-172d2a?logo=nextdotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![Prisma + Postgres](https://img.shields.io/badge/Prisma-Postgres-172d2a?logo=prisma&logoColor=white)
![LLM router](https://img.shields.io/badge/LLM-OpenAI_→_xAI_→_Gemini-ee8068)
![LiveKit](https://img.shields.io/badge/LiveKit-voz-ee8068)
![Hecho en Perú](https://img.shields.io/badge/Hecho_en-Perú_🇵🇪-d9ed8d?labelColor=172d2a)

</div>

---

AImauta es una plataforma web de tutoría educativa con inteligencia artificial que convierte los materiales curriculares en actividades de aprendizaje guiado.

El estudiante abre una ficha, intenta resolver un ejercicio y explica qué ha comprendido o qué estrategia está utilizando. A partir de ese intento, AImauta formula preguntas, ofrece pistas progresivas y muestra la fuente exacta del material consultado, **sin reemplazar el razonamiento del estudiante ni entregar inmediatamente la respuesta**.

Los docentes pueden seleccionar ejercicios, crear tareas y compartirlas mediante enlaces o códigos QR. Los estudiantes acceden desde cualquier navegador, **sin instalar ninguna aplicación**, y desarrollan la actividad con el acompañamiento de un tutor virtual.

En las tareas QR, AImauta registra de forma anónima los conteos de progreso,
intentos, turnos y pistas utilizadas. No persiste el texto del intento ni la
conversación. Esto permite observar cuánto apoyo requirió una actividad sin
incorporar nombres, notas o respuestas del estudiante al QR.

> El nombre viene de **amauta**: en el mundo andino, el maestro y sabio encargado de enseñar. AImauta es esa figura, ahora al alcance de cualquier estudiante.

---

## 🎯 Propósito

Ayudar a que **cada estudiante tenga acceso a acompañamiento educativo** cuando el docente o la familia no puedan estar presentes.

## 🤝 Promesa

> **AImauta no hace la tarea por el estudiante. Le ayuda a comprenderla y resolverla por sí mismo.**

---

## 🌟 Diferenciadores

<table>
<tr>
<td width="140" align="center" valign="top">
<img src="public/svg/amauta-points.svg" alt="Amauta señalando una pista" width="120" />
</td>
<td valign="middle">

- 🧭 **Orienta sin entregar la respuesta** de inmediato.
- 🔎 **Cada pista muestra su fuente**, con la página exacta del material.
- ✍️ **Parte del intento real** del estudiante, no de una pregunta genérica.
- 📚 Usa **materiales curriculares oficiales** previamente estructurados.
- 🔗 Permite **asignar ejercicios por QR o enlace**.
- 🌐 **Funciona directo desde la web**, sin instalar nada.
- 📈 Agrega **finalización, turnos y nivel máximo de ayuda** sin identificar al estudiante.
- 👨‍👩‍👧 Brinda un **comprobante anónimo y verificable** al completar la tarea.

</td>
</tr>
</table>

---

## 🧠 Cómo funciona

El acompañamiento sigue el ritmo natural del estudiante:

<table align="center">
<tr>
<td align="center" width="25%"><img src="public/svg/amauta-thinks.svg" width="90" alt="Amauta pensando" /><br /><b>1. Intenta</b><br /><sub>Abre la ficha y explica su razonamiento</sub></td>
<td align="center" width="25%"><img src="public/svg/amauta-points.svg" width="90" alt="Amauta señalando" /><br /><b>2. Consulta</b><br /><sub>El tutor recupera evidencia de la página exacta</sub></td>
<td align="center" width="25%"><img src="public/svg/amauta-hint.svg" width="90" alt="Amauta dando una pista" /><br /><b>3. Recibe pista</b><br /><sub>Una pregunta o pista breve, con su fuente</sub></td>
<td align="center" width="25%"><img src="public/svg/amauta-celebrates.svg" width="90" alt="Amauta celebrando" /><br /><b>4. Resuelve</b><br /><sub>Llega a la respuesta por sí mismo</sub></td>
</tr>
</table>

```text
Texto:  navegador ─► /api/tutor ─────────────────┐
                                                  ├─► tutor-service
Voz:    navegador ─► LiveKit ─► worker STT ─► /api/internal/turn
                                                  │
                                                  ├─► RAG interno localhost:3310
                                                  │    (evidencia validada con fuente)
                                                  ├─► OpenAI → xAI → Gemini
                                                  │    (elige el movimiento)
                                                  └─► guía segura de respaldo (determinista)

        navegador ◄─ LiveKit ◄─ worker TTS ◄────── respuesta socrática aprobada
```

El chat de texto y la voz comparten **un único `tutor-service`**: la voz solo convierte audio a texto, pide el mismo turno pedagógico y devuelve la respuesta aprobada como audio. No hay un segundo modelo ni una segunda política.

---

## 🔒 Seguridad y privacidad, por diseño

Una plataforma para menores exige rigor. AImauta lo trae de fábrica:

- **El LLM no redacta lo que lee el estudiante.** Solo elige una etiqueta entre **cinco movimientos pedagógicos cerrados**; el servidor renderiza una pregunta previamente aprobada. Cualquier otra salida se descarta y se activa una pregunta de respaldo determinista.
- **Publicación _fail-closed_.** Solo el material en estado `published` llega al navegador. Todo material exige tamaño fijado, `SHA-256`, fuente oficial, licencia revisada, taxonomía válida y currículo versionado sin huecos. Cualquier estado desconocido se trata como no disponible.
- **La ayuda se limita a `learn` y `practice`.** En `assessment` (Evaluamos) no hay RAG, texto ni voz — validado también en el servidor, no solo en la interfaz.
- **Sesiones anónimas.** Token firmado con `HMAC-SHA-256`, válido 2 horas. Sin cuentas, sin conversaciones persistidas y **sin datos de menores en Git**.
- **Presupuesto LLM cerrado.** OpenAI `gpt-4.1`, xAI `grok-4.3` y Gemini
  `gemini-3.6-flash` forman una cadena explícita y permitida en código. Cada
  intento reserva en PostgreSQL un presupuesto diario compartido; si el control
  falla o se agota, se usa la guía determinista.
- **Tratamiento externo explícito.** AImauta no persiste prompts ni respuestas
  en su base de datos, pero el intento y evidencia limitada se procesan
  temporalmente en el proveedor configurado con `store: false`. Este parámetro
  no sustituye un acuerdo de retención cero para un piloto institucional.
- **Avatar Tavus opcional, sin cámara del alumno.** Tavus publica por la misma sala LiveKit la voz de Inworld sincronizada con video. Un personaje 3D local (MakeHuman CC0) queda como respaldo inmediato mediante feature flag.
- **Rollback de un comando.** `./scripts/tavus-avatar.sh off` recrea solo el worker con Tavus deshabilitado; no requiere rebuild de la web.
- **Límites de tasa** por sesión y por cliente, con respaldo conservador cuando el control de borde no está presente.

---

## 📚 Contenido curricular oficial

El catálogo público usa cuadernos del **Ministerio de Educación del Perú** (primera reimpresión, setiembre 2024), con licencia [Creative Commons Atribución 4.0](https://creativecommons.org/licenses/by/4.0/) y su procedencia verificada por checksum:

| Material | Ficha oficial | SHA-256 (prefijo) |
| --- | --- | --- |
| Fichas de Matemática 1 | [MINEDU 10834](https://repositorio.minedu.gob.pe/handle/20.500.12799/10834) | `c220ec82…` |
| Fichas de Matemática 2 | [MINEDU 10835](https://repositorio.minedu.gob.pe/handle/20.500.12799/10835) | `c5c116ed…` |

La importación usa **exclusivamente** la descarga oficial del MINEDU; los metadatos y la evidencia de licencia provienen de la ficha oficial. La biblioteca permite buscar y filtrar en cascada por **Nivel → Grado → Curso**, y el visor renderiza el PDF con **PDF.js** y capa de texto seleccionable, servido desde la misma aplicación.

---

## 🛠️ Stack técnico

| Capa | Tecnología |
| --- | --- |
| **Frontend** | Next.js (App Router) · React · TypeScript |
| **Visor** | PDF.js (`pdfjs-dist`) con capa de texto |
| **Avatar** | Tavus por LiveKit (opcional) · Three.js/MakeHuman CC0 como respaldo local |
| **Datos** | Prisma · PostgreSQL |
| **Tutor / IA** | RAG interno FastAPI · router **OpenAI → xAI → Gemini** · migración posterior a Gemma |
| **Voz** | LiveKit Cloud Inference (Deepgram Nova-3 / Inworld TTS 2 · Silero VAD) |
| **Pruebas** | Vitest |
| **Licencia** | MIT |

---

## 🚀 Puesta en marcha

La configuración parte de `.env.example`. En producción son obligatorios cinco
secretos aleatorios e independientes (≥ 32 caracteres):
`AIMAUTA_SESSION_SECRET`, `AIMAUTA_AGENT_SECRET`,
`AIMAUTA_ADMIN_SECRET`,
`AIMAUTA_ASSIGNMENT_ADMIN_SECRET` y `AIMAUTA_ASSIGNMENT_TOKEN_SECRET`. Las
tareas también requieren `DATABASE_URL` y el origen HTTPS
`AIMAUTA_PUBLIC_URL`. Las claves de OpenAI, xAI y Google se guardan fuera de Git en
`/home/hii1sc/aimauta-runtime/model-providers.env`, separado del entorno web y
con permisos `0600`.

La validación se ejecuta en PowerEdge desde
`/home/hii1sc/aimauta-production`:

```bash
npm ci
npx prisma migrate deploy
npm run catalog:validate
npm run content:sync
npm run content:index
npm run lint
npm run typecheck
npm test
npm run audit:production
npm run build
```

El `postbuild` limita el standalone al runtime y falla si encuentra archivos de
entorno, secretos o rutas ajenas. Producción nunca se ejecuta desde el checkout:
se crea un release limpio en `/home/hii1sc/aimauta-releases/<commit>`, se
etiquetan las imágenes con ese commit y los datos persistentes permanecen en
`/home/hii1sc/aimauta-runtime`.

> La compilación, la indexación y el worker de voz se ejecutan en el servidor.
> El procedimiento completo de release, promoción y rollback está en
> [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

---

## 📖 Documentación

- 🏛️ [Arquitectura](docs/ARCHITECTURE.md)
- 📝 [Política de contenidos](docs/CONTENT_POLICY.md)
- 🚀 [Despliegue](docs/DEPLOYMENT.md)
- 🔗 [Tareas y códigos QR](docs/QR_ASSIGNMENTS.md)
- 🎨 [Sistema visual y marca](docs/BRAND_ASSETS.md)

---

## 🎨 Identidad

<img src="public/brand/amauta-divider.svg" alt="Separador editorial" width="100%" />

El sistema visual combina **vector funcional** (marcas e iconos SVG) con **grabado editorial** (WebP con textura). Paleta:

| | Token | Valor |
| :-: | --- | --- |
| 🟩 | Ink | `#172d2a` |
| 🟧 | Coral | `#ee8068` |
| ⬜ | Paper | `#fffdf7` |
| 🟨 | Lime | `#d9ed8d` |

---

<div align="center">

<img src="public/brand/amauta-icon.svg" alt="Símbolo de AImauta" width="56" />

**AImauta** — hecho con cuidado para los estudiantes del Perú 🇵🇪

Licencia [MIT](LICENSE)

</div>
