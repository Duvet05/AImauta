# Arquitectura de AImauta

## Objetivo

AImauta acompaña al estudiante mientras trabaja con un material escolar. Su
comportamiento central es socrático: reconoce el intento, hace una sola pregunta
o entrega una pista breve y evita revelar la respuesta final. El servidor es la
autoridad: el navegador nunca decide qué ayuda corresponde.

Propiedades transversales:

- el catálogo publica de forma cerrada (*fail-closed*) únicamente material `published`;
- el libro, la página, la etapa y el nivel de ayuda se validan en el servidor;
- texto y voz reutilizan **un solo** servicio de tutoría y una sola política;
- `Evaluamos` bloquea el tutor sin bloquear el espacio de trabajo del alumno;
- el avatar se renderiza localmente, sin cámara ni proveedor de video;
- los PDFs, índices y soluciones de ejercicios permanecen fuera de Git;
- la indisponibilidad de Ollama degrada, pero no rompe, el acompañamiento.

## Los tres planos

El sistema se organiza en tres planos con fronteras de confianza distintas:

1. **Plano de aprendizaje anónimo** (cara al estudiante) — catálogo, visor PDF,
   sesiones firmadas, tutor de texto y voz, avatar. Sin cuentas ni PII.
2. **Plano de directorio escolar** (cara al docente/admin) — datos relacionales
   en PostgreSQL (niveles, grados, cursos, estudiantes, docentes, notas). Es
   nuevo y está **detrás de un gate de admin** (ver más abajo).
3. **Pipeline privado offline** (cara al operador) — sincronización de contenido
   e ingesta de ejercicios; corre fuera del runtime público y publica artefactos
   verificados.

## Topología

```text
┌──────────────────────── navegador del estudiante ────────────────────────┐
│ visor PDF      intento escrito      chat      avatar/micrófono/altavoz    │
└──────┬─────────────────┬───────────────┬──────────────────┬──────────────┘
       │                 │               │                  │ WebRTC/datos
       │                 ├─ POST /api/session               ▼
       │                 └─ POST /api/tutor        LiveKit Cloud + Inference
       ▼                                 │          (Deepgram STT · Inworld TTS)
PowerEdge: Next.js (standalone) ─────────┤                  │
  ├─ catálogo y currículo (/config)      ▼                  ▼
  ├─ sesiones HMAC (en memoria)     tutor-service ◄─── worker de voz (Silero VAD)
  ├─ PDF + índices + ejercicios          ▲                  └─ POST /api/internal/turn
  ├─ directorio escolar ── Prisma ─► PostgreSQL              (sin LLM propio)
  └─ API LiveKit                         │
       │                                 └─ evidencia del ejercicio publicado
       └─ túnel SSH 127.0.0.1:11435 ──► Aule 127.0.0.1:11434  (Ollama + Gemma)

Pipeline offline (operador):  PDF MINEDU ─► content:sync/index ─► ingest ─► Google
                              generativelanguage.googleapis.com (Gemma/Gemini)
                              ─► revisión humana ─► promote ─► runtime
```

PowerEdge conserva la autoridad pedagógica, el contenido y el worker. Aule solo
sirve la inferencia de Gemma vía Ollama y no se publica en Internet. LiveKit
Cloud transporta el audio y ejecuta STT/TTS por *Inference*. La ingesta de
ejercicios (offline) envía imágenes de página a la API de Google.

## Aplicación web y contratos HTTP

Next.js (App Router, `output: standalone`) + TypeScript. El catálogo vive en
`lib/catalog.ts`; el currículo por página, en `lib/curriculum.ts`.

### Plano de aprendizaje (anónimo)

| Ruta | Consumidor | Responsabilidad |
| --- | --- | --- |
| `GET/HEAD /api/materials/:bookId/pdf` | visor | servir el PDF autorizado con soporte `Range` |
| `GET /api/materials/:bookId/exercises` | visor | ejercicios `published` de una página (sin soluciones) |
| `POST /api/session` | navegador | crear o mover una sesión pedagógica firmada |
| `POST /api/tutor` | navegador | procesar un turno de texto |
| `POST /api/livekit/token` | navegador | crear la sala y emitir un JWT de participante |
| `POST /api/internal/turn` | worker de voz | procesar un turno de voz con el mismo tutor |
| `GET /api/health` | infra | liveness (`{status:"ok"}`, sin datos sensibles) |

### Plano de directorio escolar (con autenticación de admin)

`GET/POST /api/{levels,grades,courses,students,teachers}` y sus subrutas
`/[id]` (`GET/PATCH/DELETE`). Toda esta superficie está protegida por
`middleware.ts` (ver «Directorio escolar»).

El visor integra PDF.js: renderiza en `canvas`, añade capa de texto
seleccionable, zoom, ajuste al ancho y navegación por teclado, y carga su worker
como módulo local. PDF.js y su respaldo nativo usan la ruta same-origin de
materiales; ninguna URL arbitraria del cliente se carga directamente. El
`iframe` queda limitado al caso en que PDF.js falla de forma definitiva.

## Catálogo curricular v2 y publicación fail-closed

`lib/catalog.ts` separa la vista administrativa de la pública. Cada entrada usa
identificadores normalizados (nivel, grado, curso, tipo, idioma) más metadatos
de edición, licencia, atribución, procedencia y archivo operativo.

Ciclo de vida: `draft → review → published`, y `published → disabled`. Solo
`published` es visible por las funciones públicas; toda entrada debe fijar
`expectedBytes` y `expectedSha256`. `npm run catalog:validate` comprueba:
taxonomía/URLs/nombre válidos; fuente PDF en la lista oficial permitida;
integridad obligatoria en todos los estados; exactamente un currículo versionado
por material; ≥1 unidad; secuencia exacta `learn → practice → assessment`; y
cobertura de todas las páginas sin huecos, duplicados ni solapamientos.

La resolución curricular es cerrada: una página sin clasificación inequívoca se
vuelve actividad no disponible, sin tutor ni RAG. `orientation` nunca habilita
tutor; solo `learn` y `practice` consultan evidencia. `npm run build` corre el
validador como puerta previa (también es `prebuild`). La biblioteca filtra en
cascada por **Nivel → Grado → Curso**, recalculando opciones descendientes.

## Currículos versionados de ocho fichas

Páginas 1–12 = orientación (`Explora`). Páginas 13–100 = ocho fichas en tres
etapas (`Construimos`, `Comprobamos`, `Evaluamos`).

### Fichas de Matemática 1

| Ficha | Tema | Construimos | Comprobamos | Evaluamos |
| ---: | --- | ---: | ---: | ---: |
| 1 | Operaciones con fracciones | 13–16 | 17–20 | 21–22 |
| 2 | Proporcionalidad en situaciones cotidianas | 23–26 | 27–29 | 30–32 |
| 3 | Mapas, escalas y desplazamientos | 33–36 | 37–40 | 41–44 |
| 4 | Medidas de tendencia central | 45–48 | 49–51 | 52–54 |
| 5 | Números enteros en situaciones reales | 55–58 | 59–62 | 63–64 |
| 6 | Inecuaciones y límites de velocidad | 65–68 | 69–72 | 73–74 |
| 7 | Cuadriláteros con el mecano | 75–78 | 79–81 | 82–86 |
| 8 | Probabilidad en promociones comerciales | 87–90 | 91–94 | 95–100 |

### Fichas de Matemática 2

| Ficha | Tema | Construimos | Comprobamos | Evaluamos |
| ---: | --- | ---: | ---: | ---: |
| 1 | Orden y comparación de fracciones | 13–16 | 17–20 | 21–22 |
| 2 | Funciones lineales en la vida cotidiana | 23–26 | 27–30 | 31–32 |
| 3 | Transformaciones en el plano cartesiano | 33–35 | 36–40 | 41–44 |
| 4 | Información estadística para tomar decisiones | 45–47 | 48–52 | 53–56 |
| 5 | Porcentajes en la vida cotidiana | 57–59 | 60–64 | 65–66 |
| 6 | Progresiones aritméticas | 67–70 | 71–74 | 75–76 |
| 7 | Ubicación y escalas en mapas | 77–79 | 80–83 | 84–86 |
| 8 | Probabilidad para tomar decisiones | 87–90 | 91–94 | 95–100 |

En `Evaluamos` el alumno lee y escribe, pero la ayuda se bloquea en varias
capas: la interfaz deshabilita revisión, chat y voz; `tutor-service` devuelve
`assessment-locked` sin consultar RAG ni Ollama; el recuperador excluye
fragmentos de páginas `Evaluamos` aun dentro de la ventana vecina; el nivel de
pista se fuerza a 0; y `/api/livekit/token` responde HTTP 423. Navegar a una
página de evaluación no acredita por sí mismo que la ficha fue completada.

## Sesiones anónimas controladas por el servidor

Una sesión no identifica a una persona y no toca la base de datos. Su estado se
serializa en un token versionado firmado con **HMAC-SHA-256** usando
`AIMAUTA_SESSION_SECRET` (`lib/learning-session.ts`), con vigencia de dos horas.
El token lleva: UUID de sesión, libro, página, ficha y etapa; conteo de intentos
distintos y turnos; nivel de pista (0–3); revisión monotónica; instantes de
creación/expiración; y un resumen HMAC del último intento (nunca el texto).

En cada verificación el servidor comprueba estructura, firma, versión y
expiración; valida libro y límites de página contra el catálogo; recalcula ficha
y etapa desde el currículo; exige que la revisión recibida sea la vigente; y
rechaza *replay*, bifurcaciones y estado inconsistente. La comparación de la
firma usa `timingSafeEqual`.

El estado vigente se mantiene en un **registro efímero en memoria**: cada
mutación consume la revisión actual y emite la siguiente, serializando cambios
de página y turnos concurrentes (máx. 40 turnos/sesión). Es **single-instance**
por diseño: al reiniciar el proceso se pierde el registro y varias réplicas no
coordinan revisiones sin un almacén compartido. No hay progreso durable todavía.

### Límites de admisión

Ventanas en memoria (`lib/rate-limit.ts`) antes de trabajo costoso:

| Operación | Clave | Límite |
| --- | --- | ---: |
| turnos de `/api/tutor` y del worker | sesión | 12/min |
| accesos de `/api/livekit/token` | sesión | 6/min |
| navegación de `/api/session` | sesión | 60/min |
| sesiones nuevas de `/api/session` | fingerprint del cliente | 12/min |

El fingerprint usa la dirección aportada por un proxy confiable.
`AIMAUTA_TRUST_PROXY_HEADERS=true` solo es seguro tras un proxy que elimine
`CF-Connecting-IP`/`X-Real-IP`/`X-Forwarded-For` del cliente y escriba su valor
canónico. Sin esa integración todas las altas comparten un bucket conservador.
Estos límites son single-instance; no sustituyen el control en el borde.

## Un solo tutor para texto y voz

`lib/tutor-service.ts` expone `guideLearningTurn`, invocada por `/api/tutor` y
`/api/internal/turn`. La operación:

1. verifica la sesión firmada y aplica el límite de admisión;
2. aplica el bloqueo de evaluación (`assessment-locked`);
3. recupera evidencia del ejercicio publicado de la página, antes de consumir la revisión;
4. evoluciona la sesión y calcula la política;
5. pide a Gemma (Ollama) elegir **una de cinco etiquetas cerradas**;
6. renderiza en servidor la pregunta aprobada, o usa una guía determinista de respaldo;
7. devuelve nueva sesión, actividad, citas y política.

Las etiquetas son `OBSERVA`, `REFORMULA`, `COMPARA`, `COMPRUEBA`, `DIVIDE` (máx.
12 tokens internos, `think:false`). **La salida cruda de Gemma nunca llega al
alumno**: `parseGuidanceMove` exige coincidencia exacta con el `Set`; cualquier
otra cosa se descarta y activa la guía determinista. La plantilla renderizada
pasa además un guard formal (una sola pregunta, sin patrones de solución). La
evidencia se envuelve en `<EVIDENCE_UNTRUSTED>…</EVIDENCE_UNTRUSTED>` para que
sus instrucciones no sustituyan la política; el guard estructural neutraliza
cualquier inyección que sobreviva.

> **Nota de implementación.** La evidencia del turno proviene del **ejercicio
> publicado** (`retrieveExerciseEvidence`: `label`/`title`/`prompt` con cita de
> página), no del texto extraído del PDF. Existe además una recuperación léxica
> por página (`lib/retrieval.ts`, `rankChunks`, ventana ±2 páginas, excluye
> `Evaluamos` y `teacherOnly`), preparada como ruta alternativa pero hoy usada
> solo en pruebas; puede sustituir el ranking sin cambiar el contrato del tutor.

El endpoint interno exige `Authorization: Bearer <AIMAUTA_AGENT_SECRET>` con
comparación en tiempo constante (`lib/internal-auth.ts`), y **falla cerrado**
(503) si el secreto falta o mide menos de 32 caracteres. Debe ser independiente
del secreto HMAC de sesión.

## Subsistema de ejercicios y su ingesta

Un ejercicio público (`lib/exercise-manifest.ts`) tiene
`id/status/unitId/stage/revision/label/title/prompt/regions[]`; su **solución**
es un artefacto separado (`finalAnswer + pedagogicalSteps + hints×3 + rubric +
reviewed + confidence`). Los estados siguen `draft → review → published →
disabled`.

Pipeline **offline**, en un operador no-root:

```text
content:sync ─► content:index ─► exercises:ingest ─► [REVISIÓN HUMANA] ─► exercises:validate ─► exercises:promote
   (SHA-256,       (índice v2      (Gemma/Gemini CLOUD:                       (0 pendientes,        (activación
    %PDF-, size)    por página)     detecta y pre-resuelve)                    ≥1 published)         2 fases + rollback)
```

- **Ingesta (`lib/exercise-ingestion.ts`, `lib/gemma-ingest.ts`).** Abre el PDF
  fijado por SHA-256, lo renderiza a **imágenes** en ventanas de 3 páginas y las
  envía a la **API cloud de Google** (`generativelanguage.googleapis.com`,
  modelo `gemma-4-26b-a4b-it`) con *function-calling* forzado (`mode:ANY`). Las
  imágenes se marcan como contenido **no confiable**; la defensa dura es el
  esquema rígido de salida + `reviewRequired:true`. Sale como `*.draft.json`.
- **Egress externo.** Esta es una **segunda dependencia de IA**, distinta del
  Ollama/Gemma local del tutor. Requiere `AIMAUTA_GEMINI_API_KEY_FILE`; el
  endpoint no-Google solo se permite con opt-in explícito.
- **Revisión humana obligatoria** antes de `promote`. La confianza es del revisor.
- **Separación de soluciones.** Las soluciones viven en un directorio/mount
  aparte (`AIMAUTA_EXERCISE_SOLUTION_DIR`), archivo `<id>.private.json`, distinto
  del manifiesto público. `lib/exercise-store.ts` **solo** abre `<id>.public.json`
  (con `O_NOFOLLOW`) y proyecta campos por allow-list; la ruta `/exercises` no
  puede filtrar soluciones. `getReviewedExerciseSolution` es server-only, exige
  `reviewed:true` + revisión coincidente, y el `finalAnswer` solo se revela al
  alumno cuando `policy.canRevealSolution` es true (tras agotar las 3 pistas).
- **Promoción (`exercise-release-promotion.ts`).** Transacción con lock:
  re-valida el release, re-hashea PDF+índice desplegados, escribe snapshot
  `new/previous` y **activa el privado antes que el público**, con rollback.

## Directorio escolar y panel docente

Modelo relacional en PostgreSQL vía Prisma (`prisma/schema.prisma`), **separado**
del catálogo de libros:

```text
Level ─┬─ Grade ─┬─ Course ─┬─ Enrollment(Student × Course) ─┬─ Evaluation
       │         │          └─ Teacher (M:N)                 └─ ProgressNote (status: EXCELLING…AT_RISK)
       └─────────┴── ConfigSnapshot (copia JSON de /config para auditoría)
```

`Evaluation.unitId` es un string suelto (no FK): las unidades viven en el
catálogo versionado de `/config`, no en la BD. `ConfigSnapshot` guarda copias
crudas de `/config` para consulta, pero la app sigue leyendo los archivos (dos
representaciones, una sola fuente de verdad: los archivos).

### Autenticación (interina)

`middleware.ts` protege `/api/{students,teachers,courses,grades,levels}/*`.
Exige `Authorization: Bearer <AIMAUTA_ADMIN_SECRET>` con comparación en tiempo
constante (HMAC doble, apto Edge/Node) y **falla cerrado**: sin secreto o
`<32` chars → 503; sin bearer o inválido → 401. Es el único punto de
enforcement y cubre rutas futuras del directorio. Es un **bearer de admin
único**, no roles por usuario; la autenticación por usuario (docente/admin) es
el siguiente paso.

### Borrado en cascada con confirmación

Los `DELETE` del directorio cuentan sus hijos y responden **409** si existen,
salvo que la solicitud incluya `?cascade=true` (`cascadeRequested` /
`cascadeBlockedResponse` en `lib/http.ts`). Esto evita que un solo `DELETE`
arrase un subárbol académico (grados → cursos → matrículas → notas y feedback)
por accidente.

## Canal de voz

### Creación de sala y dispatch

`POST /api/livekit/token` acepta solo una sesión HMAC válida y habilitada para
tutoría. Crea/actualiza la sala `aimauta-<sessionId>`, añade metadata canónica y
emite un JWT de estudiante por 15 minutos. Solicita un dispatch nombrado
exactamente `aimauta-socratic-tutor`; el worker se registra con el mismo nombre
(contrato de despliegue: un nombre distinto deja la sala sin agente).

El navegador no habilita el micrófono hasta ver un participante con
`isAgent=true`, identidad `agent-*` y `lk.agent.name=aimauta-socratic-tutor`. Si
no aparece en 12 s, la activación falla cerrada y limpia audio y micrófono. La
credencial pedagógica inicial viaja en metadata de dispatch (no en metadata de
sala); las revisiones posteriores, en paquetes de datos fiables, aceptados solo
desde las identidades exactas esperadas.

### Sincronización

| Dirección | Tópico | Carga |
| --- | --- | --- |
| navegador → worker | `aimauta.context.v1` | `{"v":1,"sessionToken":"…"}` |
| worker → navegador | `aimauta.session.v1` | token nuevo, sesión y actividad |

El backend anti-replay es la autoridad cuando texto, navegación y voz compiten
por evolucionar la misma sesión.

### Worker sin LLM propio

`services/voice-agent` (Python, LiveKit Agents). Cadena:

```text
Silero VAD ─► LiveKit Inference · Deepgram Nova-3 (STT)
   └─► POST /api/internal/turn ─► tutor-service ─► Ollama/Gemma o respaldo
   ◄─────────────────── respuesta aprobada
◄─ LiveKit Inference · Inworld TTS-2, voz «Diego» (TTS)
```

La sesión se configura con `llm=None`: el worker **no** construye prompts, no
consulta RAG y no llama a Ollama; solo transcribe, autentica la llamada interna,
publica la sesión actualizada y sintetiza la respuesta aprobada. Si el backend
falla, reproduce un aviso breve sin inventar pistas. `AgentSession` usa
`record=False`, log `WARN` con redacción, health server solo en `127.0.0.1`,
deadline de 10 minutos y `delete_room_on_close`.

> No habilitar grabación no elimina el tratamiento: LiveKit Cloud transporta el
> WebRTC y LiveKit Inference usa **Deepgram** (STT) e **Inworld** (TTS). Aunque
> la inferencia aplique retención cero por defecto, un piloto con menores exige
> consentimiento, acuerdos de tratamiento y política de retención/eliminación.

## Avatar local y privado

Al activar la voz, el navegador carga de forma diferida Three.js y un GLB
sintético CC0 (MakeHuman) alojado por la propia app. Un `AnalyserNode` calcula
solo el nivel RMS de la pista ya autorizada y anima morph-targets localmente; no
genera transcripción, ni transmite biometría, cámara o video. `Permissions-Policy`
permite micrófono solo same-origin y bloquea cámara, captura y geolocalización.
Render a 30 FPS, libera WebGL/Web Audio al cerrar, y cae a un SVG local si falla
WebGL o el modelo. `prefers-reduced-motion` deja solo el respaldo sin animación.

## Contenido, integridad y RAG

La ruta de materiales busca el PDF en `AIMAUTA_CONTENT_DIR`; si no existe,
responde cerrado. El proxy remoto está deshabilitado por defecto y, aun activo,
solo acepta URLs oficiales de la lista permitida.

**Integridad verificada por request.** `lib/file-integrity.ts` valida tamaño
contra `expectedBytes`, hashea (SHA-256) *el mismo descriptor* que servirá el
caller y re-`stat` tras hashear para confirmar identidad; cualquier discrepancia
→ HTTP 503 «no coincide con la edición aprobada». La caché solo guarda éxitos de
archivos read-only.

`content:sync` comprueba dominio/ruta, `%PDF-`, tamaño y SHA-256, y escribe un
manifiesto runtime v2 atómico. `content:index` re-verifica el checksum, extrae
texto por página y genera un índice v2 (contrato+extractor, checksum, taxonomía,
páginas, versión curricular, licencia, etapa/ficha por fragmento, marca
`teacherOnly`, reporte de calidad). Índices incompatibles fallan cerrado. Los
dos PDFs se importan solo del Repositorio Institucional del MINEDU;
`librosescolaresperu.com` participa solo en el descubrimiento.

## Integración continua

`.github/workflows/ci.yml` — un job `validate` en PRs y push a `main`, acciones
**fijadas por SHA**, `cancel-in-progress`, Node 22. Secuencia:

`npm ci` → `catalog:validate` → `typecheck` → `lint` → `test` (vitest) →
`npm audit --omit=dev --audit-level=high` → `build` → validación de manifiestos
de despliegue (`docker compose config` + `nginx -t`) → build de la imagen web →
build+`pytest` de la imagen del worker de voz → smoke del contrato de inferencia
(instancia STT Deepgram + TTS Inworld con credenciales de prueba).

## Despliegue y topología operativa

Un host **PowerEdge** corre dos contenedores host-network, rootfs read-only,
`cap_drop`, `no-new-privileges`, no-root: Next.js (`127.0.0.1:3309`) y nginx
(`127.0.0.1:3308`). La única exposición pública es **Tailscale Funnel** →
`:3308`. La build de contenido, la indexación y el worker corren en PowerEdge; la
Mac solo edita y versiona.

Secretos obligatorios en producción (≥32 chars, independientes):
`AIMAUTA_SESSION_SECRET`, `AIMAUTA_AGENT_SECRET`, `AIMAUTA_ADMIN_SECRET`; más
`DATABASE_URL` y, con voz activa, las variables `LIVEKIT_*`. Ollama permanece en
`Aule` y se alcanza por un **túnel SSH reverso loopback** (`127.0.0.1:11435` →
`127.0.0.1:11434`); nunca escucha en `0.0.0.0` ni por Funnel. Detalle operativo
en [`DEPLOYMENT.md`](DEPLOYMENT.md).

## Fronteras de confianza

```text
Internet público
  ├─ navegador: entrada no confiable
  └─ LiveKit Cloud: WSS, SFU, TURN e Inference (Deepgram STT · Inworld TTS)

PowerEdge (runtime público)
  ├─ Next.js: autoridad de sesión, currículo, tutor y directorio
  ├─ PostgreSQL: directorio escolar (PII; gated por AIMAUTA_ADMIN_SECRET)
  ├─ worker de voz: adaptador sin LLM
  └─ PDFs autorizados, índices y manifiestos reproducibles

Canal privado PowerEdge–Aule
  └─ SSH sobre la tailnet: 127.0.0.1:11435 → Ollama 127.0.0.1:11434

Egress externo (pipeline offline, no runtime)
  └─ Google generativelanguage.googleapis.com: imágenes de página para la ingesta
```

## Límites de contenido y datos

- No se versionan PDFs, índices, manifiestos ni soluciones de ejercicios.
- No se importa material sin ficha oficial del MINEDU y licencia verificada.
- El plano de aprendizaje no persiste conversaciones ni intentos; el registro
  anti-replay es efímero y en memoria.
- El plano de directorio **sí** almacena PII (nombres, correos, notas de
  menores); su acceso está tras `AIMAUTA_ADMIN_SECRET` y pendiente de roles por
  usuario, retención y eliminación definidas.

## Estado, seguridad y próximos pasos

La postura de seguridad, los hallazgos verificados y la hoja de ruta se
documentan en [`SECURITY_REVIEW.md`](SECURITY_REVIEW.md). Pendientes principales:
autenticación por usuario (rol docente/admin) para el directorio; mover
anti-replay y rate-limit a un almacén compartido antes de escalar; y definir la
gobernanza de datos (consentimiento, retención, egress a Google) antes de un
piloto con menores.
