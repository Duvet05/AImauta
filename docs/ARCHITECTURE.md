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
- el avatar 3D se renderiza localmente como respaldo; Tavus puede sustituirlo
  con video remoto explícitamente habilitado y sin usar la cámara del alumno;
- los PDFs, índices y soluciones de ejercicios permanecen fuera de Git;
- la indisponibilidad de los proveedores LLM degrada, pero no rompe, el
  acompañamiento.

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
       ▼                                 │       (Deepgram STT · Inworld TTS · Tavus opcional)
PowerEdge: Next.js (standalone) ─────────┤                  │
  ├─ catálogo y currículo (/config)      ▼                  ▼
  ├─ sesiones HMAC (en memoria)     tutor-service ◄─── worker de voz (Silero VAD)
  ├─ PDF + ejercicios                    ▲                  └─ POST /api/internal/turn
  ├─ RAG interno 127.0.0.1:3310 ─────────┘
  │    └─ índices v2 read-only
  ├─ directorio + tareas QR ─ Prisma ─► PostgreSQL            (sin LLM propio)
  ├─ API LiveKit                         │
  ├─ túnel SSH 127.0.0.1:11435 ─────────┴─► Aule 127.0.0.1:11434
  │                                            (Gemma 4 primario)
  └─ HTTPS opcional ───────────────────────► OpenAI / xAI / Gemini

Pipeline offline (operador):  PDF MINEDU ─► content:sync/index ─► ingest
                              ─► Gemma 4 Ollama (Google opcional explícito)
                              ─► revisión humana ─► promote ─► runtime
```

PowerEdge conserva la autoridad pedagógica, el contenido, el recuperador y el
worker. El servicio RAG separado adapta el límite HTTP del prototipo de Marcelo,
pero abre únicamente los índices v2 verificados de AImauta y escucha solo en
`127.0.0.1:3310`; no recibe claves de modelo, PDFs arbitrarios ni datos
persistentes del estudiante. El router usa Gemma 4 en Ollama/Aule como primario
por el túnel privado; OpenAI, xAI y Gemini son fallbacks opcionales y
explícitos. LiveKit Cloud transporta el audio y ejecuta STT/TTS
por *Inference*. La ingesta de ejercicios es offline y usa Gemma 4 por el
túnel privado; Google permanece como modo alternativo explícito.

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
`assessment-locked` sin consultar RAG ni ningún proveedor LLM; el recuperador excluye
fragmentos de páginas `Evaluamos` aun dentro de la ventana vecina; el nivel de
pista se fuerza a 0; y `/api/livekit/token` responde HTTP 423. Navegar a una
página de evaluación no acredita por sí mismo que la ficha fue completada.

## Sesiones anónimas controladas por el servidor

Una sesión no identifica a una persona y no toca la base de datos. Su estado se
serializa en un token versionado (esquema v5) firmado con **HMAC-SHA-256** usando
`AIMAUTA_SESSION_SECRET` (`lib/learning-session.ts`), con vigencia de dos horas.
El token lleva: UUID de sesión, libro, página, ficha y etapa; conteo de intentos
distintos y turnos; nivel de pista (0–3); revisión monotónica; instantes de
creación/expiración; y hasta doce resúmenes HMAC de intentos sustantivos (nunca el texto).

En cada verificación el servidor comprueba estructura, firma, versión y
expiración; valida libro y límites de página contra el catálogo; recalcula ficha
y etapa desde el currículo; exige que la revisión recibida sea la vigente; y
rechaza *replay*, bifurcaciones y estado inconsistente. La comparación de la
firma usa `timingSafeEqual`.

El estado vigente se mantiene en un **registro efímero en memoria**: cada
mutación consume la revisión actual y emite la siguiente, serializando cambios
de página y turnos concurrentes (máx. 40 turnos/sesión). Es **single-instance**
por diseño: al reiniciar el proceso se pierde el registro y varias réplicas no
coordinan revisiones sin un almacén compartido. El aprendizaje anónimo no tiene
progreso durable; las **tareas QR** (ver abajo) sí conservan estado y agregados
anónimos en PostgreSQL.

### Límites de admisión

Ventanas en memoria (`lib/rate-limit.ts`) antes de trabajo costoso:

| Operación | Clave | Límite |
| --- | --- | ---: |
| turnos de `/api/tutor` y del worker | sesión | 12/min |
| accesos de `/api/livekit/token` | sesión | 6/min |
| navegación de `/api/session` | sesión | 60/min |
| sesiones nuevas de `/api/session` | fingerprint del cliente | 12/min |
| apertura de enlace QR | fingerprint + tarea | 120/min |
| ejecuciones QR nuevas | fingerprint + tarea | 60/min |
| reanudación QR | token de ejecución | 120/min |
| sesión/finalización de objetivo QR | token de ejecución | 30/min |

El fingerprint usa la dirección aportada por un proxy confiable.
`AIMAUTA_TRUST_PROXY_HEADERS=true` solo es seguro tras un proxy que elimine
`CF-Connecting-IP`/`X-Real-IP`/`X-Forwarded-For` del cliente y escriba su valor
canónico. Sin esa integración todas las altas comparten un bucket conservador.
Estos límites son single-instance; no sustituyen el control en el borde.

## Tareas QR durables y anónimas

Un docente puede empaquetar contenido en una **tarea** compartible por QR o
enlace, que el estudiante abre sin cuenta. Contratos:

| Ruta | Consumidor | Responsabilidad |
| --- | --- | --- |
| `POST /api/assignments` | integración docente | crear una tarea con snapshot del contenido |
| `GET /api/assignments/:id/qr` | integración docente | descargar el QR (SVG, PNG o PDF) |
| `POST /api/assignments/public/:token/runs` | navegador | iniciar una ejecución anónima |
| `POST /api/assignment-runs/current/items/:id/session` | navegador | abrir una sesión limitada al objetivo |
| `POST /api/assignment-runs/current/items/:id/complete` | navegador | finalizar un objetivo y emitir comprobante |

`Assignment` fija docente, curso o etiqueta de grupo, disponibilidad,
vencimiento, nivel máximo de ayuda y criterio de finalización. Sus
`AssignmentItem` son **snapshots inmutables** de una ficha, página o ejercicio
(checksum del PDF, versión curricular, revisión del ejercicio); una incoherencia
posterior con el contenido publicado invalida el acceso de forma cerrada.

El QR lleva un token público aleatorio de **256 bits**. PostgreSQL guarda su
hash para resolverlo y una copia AES-256-GCM para re-renderizarlo desde una ruta
administrativa. Crear una ejecución emite otro token aleatorio que el navegador
presenta por **Bearer, nunca por URL**. Las ejecuciones y sus objetivos no
contienen identidad del estudiante.

Al emitir una sesión pedagógica desde una tarea, el payload HMAC incorpora ID de
tarea/ejecución/objetivo, el conjunto exacto de páginas permitidas, el ejercicio
y revisión (si el docente fijó uno) y el nivel máximo de ayuda (0–3).
`moveLearningSession` reverifica esas restricciones en cada navegación.
`tutor-service` escribe tras cada turno **solo** conteos y pista máxima en
`AssignmentItemProgress`; el intento y la conversación siguen siendo efímeros.
Completar los objetivos requeridos emite un tercer token opaco para un
comprobante anónimo.

Las rutas de gestión exigen, de forma interina,
`AIMAUTA_ASSIGNMENT_ADMIN_SECRET` (credencial de integración server-to-server,
no autenticación personal de docentes). El contrato y los límites del piloto se
detallan en [`QR_ASSIGNMENTS.md`](QR_ASSIGNMENTS.md).

## Un solo tutor para texto y voz

`lib/tutor-service.ts` expone `guideLearningTurn`, invocada por `/api/tutor` y
`/api/internal/turn`. La operación:

1. verifica la sesión firmada y aplica el límite de admisión;
2. aplica el bloqueo de evaluación (`assessment-locked`);
3. recupera evidencia con alcance exacto de página o del ejercicio publicado,
   antes de consumir la revisión;
4. evoluciona la sesión y calcula la política;
5. pide al router LLM elegir **una de cinco etiquetas cerradas**;
6. renderiza en servidor la pregunta aprobada, o usa una guía determinista de respaldo;
7. devuelve nueva sesión, actividad, citas y política.

Las etiquetas son `OBSERVA`, `REFORMULA`, `COMPARA`, `COMPRUEBA`, `DIVIDE`.
La petición limita la salida a 16 tokens —el mínimo de Responses API— y
`parseGuidanceMove` exige coincidencia exacta con el `Set`. **La salida cruda
del proveedor nunca llega al alumno**: cualquier otro contenido se descarta y
activa la guía determinista. La plantilla renderizada pasa además un guard
formal (una sola pregunta, sin patrones de solución). La evidencia se envuelve
en `<EVIDENCE_UNTRUSTED>…</EVIDENCE_UNTRUSTED>` para que sus instrucciones no
sustituyan la política; el guard estructural neutraliza cualquier inyección que
sobreviva.

> **Nota de implementación.** Con un **ejercicio publicado**, la evidencia
> procede de su transcripción revisada ligada a checksum, revisión y regiones
> del PDF dentro del bundle atómico; solo esa ruta puede liberar una respuesta
> humana revisada tras agotar las pistas. En una tarea de página o ficha sin ejercicio,
> Next.js consulta `services/rag-service` por loopback con checksum, versión
> curricular, unidad, etapa y página exactos; si está indisponible usa el mismo
> índice validado localmente. Esta segunda ruta siempre mantiene
> `canRevealSolution=false`. Ambas excluyen `Evaluamos` y `teacherOnly`.

### Router Gemma-first y presupuesto de inferencia

`lib/llm.ts` admite una cadena cerrada y explícita de hasta tres intentos entre
Ollama `gemma4:e4b-it-qat`, OpenAI `gpt-4.1`, xAI `grok-4.3` y Gemini
`gemini-3.6-flash`. La configuración predeterminada intenta sólo Gemma 4; los
proveedores cloud deben nombrarse explícitamente como fallbacks. Los endpoints
y modelos están permitidos en código: Ollama sólo acepta loopback y valida el
modelo tanto al enviar como al recibir. No hay reintentos dentro de un
proveedor.

Gemma recibe una petición local `/api/chat` con `think: false`, salida acotada
y redirecciones bloqueadas. OpenAI y xAI reciben una petición mínima por
Responses API. Gemini usa
`generateContent` en el endpoint fijo de Google, autentica por
`x-goog-api-key`, solicita razonamiento `minimal` sin resúmenes de pensamiento
y rechaza respuestas truncadas, múltiples o sin un único texto final. Las rutas
cloud envían `store: false`. OpenAI recibe como `safety_identifier` únicamente
un hash unidireccional del UUID efímero de sesión; xAI se invoca sin
razonamiento extendido. El backend no adjunta el token HMAC, el token QR, notas ni
identificadores del directorio escolar. Sí se procesan el texto libre que el
estudiante escribió y fragmentos acotados de evidencia curricular; ese texto
podría incluir un dato que el propio estudiante escriba.

El presupuesto se reserva de forma atómica en PostgreSQL antes de cada intento.
`LlmUsageDay` conserva solo el día UTC y contadores agregados de solicitudes y
tokens usados o reservados; no guarda prompts, respuestas, sesiones, proveedor
ni estudiante. Los máximos compilados son 300 intentos, 150 000 tokens de
entrada y 6 000 de salida por día. Las variables de entorno pueden reducirlos,
pero nunca aumentarlos. Hay además un máximo de dos solicitudes concurrentes,
20 intentos por minuto, 45 segundos de timeout para Gemma local y 15 segundos
para proveedores cloud. Si PostgreSQL, el presupuesto o los proveedores no
están disponibles, `tutor-service` usa la guía
determinista sin eludir el límite.

`store: false` desactiva el almacenamiento de la petición en las APIs
compatibles, pero no equivale por sí solo a retención cero ni reemplaza los
controles del proyecto. La configuración estándar de
[OpenAI](https://developers.openai.com/api/docs/guides/your-data) y
[xAI](https://docs.x.ai/developers/faq/security) puede conservar contenido por
hasta 30 días para monitoreo de abuso; Google separa los logs configurables de
los datos que pueda conservar para ese monitoreo, según su
[política de logs](https://ai.google.dev/gemini-api/docs/logs-policy). Antes de
un piloto institucional con menores se debe verificar el control de retención
apropiado en cada proyecto, además de los consentimientos y acuerdos aplicables.

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
   (SHA-256,       (índice v2      (Gemma 4 multimodal:                       (0 pendientes,        (bundle atómico
    %PDF-, size)    por página)     detecta y pre-resuelve)                    ≥1 published)         + rollback)
```

- **Ingesta (`lib/exercise-ingestion.ts`, adaptadores Gemma).** Abre el PDF
  fijado por SHA-256, lo renderiza a **imágenes** en ventanas de 3 páginas y las
  envía por defecto a Gemma 4 en Ollama loopback; Google
  (`generativelanguage.googleapis.com`, `gemma-4-26b-a4b-it`) requiere selección
  y clave explícitas. Las
  imágenes se marcan como contenido **no confiable**; la defensa dura es el
  esquema rígido de salida + `reviewRequired:true`. Sale como `*.draft.json`.
- **Egress de ingesta.** Ollama permanece en el túnel loopback. El modo Google
  es una alternativa offline explícita que requiere
  `AIMAUTA_GEMINI_API_KEY_FILE`; un endpoint no-Google exige además opt-in.
- **Revisión humana obligatoria** antes de `promote`. La confianza es del revisor.
- **Separación de soluciones.** El release autoritativo vive en el mount
  privado (`AIMAUTA_EXERCISE_SOLUTION_DIR`) como `<id>.release.json` y activa
  público/privado con un solo rename. `lib/exercise-store.ts` proyecta
  exclusivamente la mitad pública; la ruta `/exercises` no puede filtrar
  soluciones. `getReviewedExerciseSolution` es server-only, exige
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
   └─► POST /api/internal/turn ─► tutor-service ─► Gemma / nube opcional / respaldo
   ◄─────────────────── respuesta aprobada
◄─ LiveKit Inference · Inworld TTS-2, voz «Diego» (TTS)
```

La sesión se configura con `llm=None`: el worker **no** construye prompts, no
consulta RAG y no llama directamente a proveedores LLM; solo transcribe,
autentica la llamada interna, publica la sesión actualizada y sintetiza la
respuesta aprobada. Si el backend falla, reproduce un aviso breve sin inventar
pistas. `AgentSession` usa
`record=False`, log `WARN` con redacción, health server solo en `127.0.0.1`,
deadline de 10 minutos y `delete_room_on_close`.

> No habilitar grabación no elimina el tratamiento: LiveKit Cloud transporta el
> WebRTC y LiveKit Inference usa **Deepgram** (STT) e **Inworld** (TTS). Aunque
> la inferencia aplique retención cero por defecto, un piloto con menores exige
> consentimiento, acuerdos de tratamiento y política de retención/eliminación.

## Avatar Tavus opcional con respaldo local

Con `TAVUS_AVATAR_ENABLED=true`, el plugin servidor crea una conversación Tavus
en pipeline `echo`; Tavus entra a la sala como participante delegado y publica
la voz de Inworld sincronizada con video. El navegador no solicita ni publica
la cámara del alumno. Solo acepta media de la identidad Tavus exacta y nunca
acepta de ella mensajes que modifiquen la sesión pedagógica.

Mientras el video remoto no esté disponible, y siempre que Tavus esté
deshabilitado, el navegador usa Three.js y un GLB sintético CC0 (MakeHuman)
alojado por la propia app. Un `AnalyserNode` anima morph-targets localmente con
el nivel RMS. El respaldo libera WebGL/Web Audio al cerrar y cae a un SVG si
falla WebGL o el modelo.

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

`services/rag-service` sirve recuperación léxica sobre esos mismos índices, no
sobre los PDFs de prueba del prototipo. El cliente solo acepta el endpoint fijo
`http://127.0.0.1:3310`, limita cada respuesta a 64 KiB y vuelve a verificar
linaje, alcance curricular y esquema. El contenedor es no-root, read-only, sin
capacidades y con el directorio de índices montado en solo lectura. Si el
servicio cae, la aplicación usa el recuperador TypeScript local; si tampoco hay
evidencia válida, no llama al LLM y falla cerrado.

## Integración continua

`.github/workflows/ci.yml` — un job `validate` en PRs y push a `main`, acciones
**fijadas por SHA**, `cancel-in-progress`, Node 22. Secuencia:

`npm ci` → `catalog:validate` → `typecheck` → `lint` → `test` (vitest) →
`npm audit --omit=dev --audit-level=high` → `build` → validación de manifiestos
de despliegue (`docker compose config` + `nginx -t`) → build de la imagen web →
test+build de la imagen RAG → build+`pytest` de la imagen del worker de voz →
smoke del contrato de inferencia (instancia STT Deepgram + TTS Inworld con
credenciales de prueba).

## Despliegue y topología operativa

Un host **PowerEdge** corre tres contenedores permanentes host-network, rootfs
read-only, `cap_drop`, `no-new-privileges`, no-root: Next.js
(`127.0.0.1:3309`), RAG (`127.0.0.1:3310`) y nginx
(`127.0.0.1:3308`), además del worker de voz cuando está activo. La única
exposición pública es **Tailscale Funnel** → `:3308`. La build de contenido y
la indexación corren en PowerEdge; la Mac solo edita y versiona.

Secretos obligatorios en producción (≥32 chars, independientes):
`AIMAUTA_SESSION_SECRET`, `AIMAUTA_AGENT_SECRET`, `AIMAUTA_ADMIN_SECRET`,
`AIMAUTA_ASSIGNMENT_ADMIN_SECRET` y `AIMAUTA_ASSIGNMENT_TOKEN_SECRET`; además
se requieren `DATABASE_URL` y la configuración loopback de Ollama en un archivo
runtime separado. Las credenciales cloud sólo son necesarias al habilitar un
fallback. Con voz activa se añaden las variables `LIVEKIT_*`. Ollama corre en
`Aule` y se alcanza por un
**túnel SSH local loopback** (`127.0.0.1:11435` → `127.0.0.1:11434`); nunca
escucha en `0.0.0.0` ni por Funnel. Detalle operativo en
[`DEPLOYMENT.md`](DEPLOYMENT.md).

## Fronteras de confianza

```text
Internet público
  ├─ navegador: entrada no confiable
  └─ LiveKit Cloud: WSS, SFU, TURN e Inference (Deepgram STT · Inworld TTS)

PowerEdge (runtime público)
  ├─ Next.js: autoridad de sesión, currículo, tutor y directorio
  ├─ RAG interno: recuperación validada, sin claves ni persistencia
  ├─ PostgreSQL: directorio escolar, tareas QR y presupuesto LLM
  ├─ worker de voz: adaptador sin LLM
  └─ PDFs autorizados, índices y manifiestos reproducibles

Egress externo opcional del runtime
  └─ OpenAI / xAI / Google Gemini: fallbacks pedagógicos explícitos

Canal privado PowerEdge–Aule
  └─ SSH sobre la tailnet: Gemma 4 en 127.0.0.1:11435 → Ollama 127.0.0.1:11434

Egress externo (pipeline offline)
  └─ Google generativelanguage.googleapis.com en modo ingesta explícito
```

## Límites de contenido y datos

- No se versionan PDFs, índices, manifiestos ni soluciones de ejercicios.
- No se importa material sin ficha oficial del MINEDU y licencia verificada.
- El plano de aprendizaje no persiste conversaciones ni intentos; el registro
  anti-replay es efímero y en memoria.
- Las tareas QR guardan progreso y conteos anónimos por ejecución. El control
  LLM guarda solo contadores diarios agregados, nunca prompts ni respuestas.
- Gemma procesa el intento y la evidencia acotada en la infraestructura
  privada. Los fallbacks cloud procesan ese contenido temporalmente si se
  habilitan; `store:false` no equivale a retención cero.
- El plano de directorio **sí** almacena PII (nombres, correos, notas de
  menores); su acceso está tras `AIMAUTA_ADMIN_SECRET` y pendiente de roles por
  usuario, retención y eliminación definidas.

## Estado, seguridad y próximos pasos

La postura de seguridad, los hallazgos verificados y la hoja de ruta se
documentan en [`SECURITY_REVIEW.md`](SECURITY_REVIEW.md). Pendientes principales:
autenticación por usuario (rol docente/admin) para el directorio; mover
anti-replay y rate-limit a un almacén compartido antes de escalar; y definir la
gobernanza de datos (consentimiento y retención verificada para cualquier
fallback cloud habilitado) antes de un piloto con menores.
