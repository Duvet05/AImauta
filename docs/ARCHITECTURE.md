# Arquitectura de AImauta

## Objetivo

AImauta acompaña al estudiante mientras trabaja con un material escolar. Su
comportamiento central es socrático: reconoce el intento, hace una sola pregunta
o entrega una pista breve y evita revelar la respuesta final.

La iteración de biblioteca curricular integra catálogo, visor, currículo,
estado pedagógico, avatar y canales de texto y voz bajo una misma autoridad del
servidor. Sus propiedades principales son:

- el catálogo publica de forma cerrada únicamente materiales `published`;
- el libro, la página, la etapa y el nivel de ayuda se validan en el servidor;
- texto y voz reutilizan la misma recuperación y la misma política pedagógica;
- `Evaluamos` bloquea el tutor sin bloquear el espacio de trabajo del alumno;
- el avatar se renderiza localmente, sin cámara ni proveedor de video;
- los PDFs y los índices permanecen fuera de Git;
- la indisponibilidad de Ollama no rompe el acompañamiento básico.

## Topología actual

```text
┌──────────────────────── navegador del estudiante ────────────────────────┐
│ visor PDF       intento escrito       chat       avatar/micrófono/altavoz│
└──────┬──────────────────┬────────────────┬──────────────────┬────────────┘
       │                  │                │                  │ WebRTC/datos
       │                  ├─ POST /api/session               ▼
       │                  └─ POST /api/tutor    LiveKit self-hosted
       │                                   │                 │
       ▼                                   ▼                 ▼
PowerEdge: Next.js ─────────────────► tutor-service   worker de voz
  ├─ catálogo y currículo                  ▲           ├─ Silero VAD
  ├─ sesiones HMAC                         │           ├─ Deepgram STT
  ├─ PDF e índice RAG                      └───────────┤  /api/internal/turn
  └─ API LiveKit                                       └─ Deepgram TTS
       │
       └─ túnel SSH 127.0.0.1:11435 ──► Aule 127.0.0.1:11434
                                          Ollama + Gemma
```

LiveKit Server y su TURN integrado transportan audio y datos del canal de voz
en infraestructura administrada por el equipo. PowerEdge conserva la autoridad
pedagógica, el contenido y el worker. Aule solo sirve la inferencia de Gemma a
través de Ollama y no se publica en Internet.

## Aplicación web y contratos HTTP

La aplicación usa Next.js con App Router y TypeScript. El catálogo vive en
`lib/catalog.ts`; el currículo por página, en `lib/curriculum.ts`.

| Ruta | Consumidor | Responsabilidad |
| --- | --- | --- |
| `GET/HEAD /api/materials/:bookId/pdf` | visor | servir el PDF autorizado con soporte `Range` |
| `POST /api/session` | navegador | crear o mover una sesión pedagógica firmada |
| `POST /api/tutor` | navegador | procesar un turno de texto |
| `POST /api/livekit/token` | navegador | crear la sala y emitir un JWT de participante |
| `POST /api/internal/turn` | worker | procesar un turno de voz mediante el mismo tutor |

El visor integra PDF.js en el navegador: renderiza en `canvas`, añade una capa
de texto seleccionable, ofrece zoom, ajuste al ancho y navegación por teclado,
y carga su worker como módulo local. Tanto PDF.js como su respaldo nativo usan
la ruta same-origin de materiales; ninguna URL arbitraria del cliente se carga
directamente. El `iframe` queda limitado al caso en que PDF.js falla de forma
definitiva o repetida.

## Catálogo curricular v2 y publicación fail-closed

`lib/catalog.ts` separa la vista administrativa de la vista pública. Cada
entrada usa identificadores normalizados para nivel, grado, curso, tipo de
material e idioma, además de metadatos de edición, licencia, atribución,
procedencia y archivo operativo.

El ciclo de vida es:

```text
draft → review → published
                    │
                    └─► disabled
```

Solo `published` es visible mediante las funciones públicas del catálogo. Toda
entrada debe fijar `expectedBytes` y `expectedSha256`; una entrada `draft`,
`review` o `disabled` se comporta como inexistente para la aplicación.
`npm run catalog:validate` comprueba además:

- taxonomía, URLs y nombre de archivo válidos;
- fuente PDF dentro de la lista oficial permitida;
- metadatos y pin de integridad obligatorios para todos los estados;
- exactamente un currículo versionado por material publicado;
- al menos una unidad por currículo;
- secuencia exacta `learn → practice → assessment` dentro de cada unidad;
- cobertura de todas las páginas, sin huecos, duplicados ni solapamientos.

La resolución curricular también es cerrada: una página sin clasificación
inequívoca, o perteneciente a un currículo cuya estructura completa no sea
segura, se convierte en una actividad no disponible y sin tutor ni RAG. Así,
una orientación que abarque todo un libro sin unidades no habilita ayuda
accidentalmente. `npm run build` ejecuta el validador automáticamente antes de
compilar. Además, `orientation` es siempre una zona sin tutor: solo las etapas
explícitas `learn` y `practice` pueden consultar RAG. Esto mantiene cerrado el
caso de una portada u orientación sobredimensionada aunque supere por error la
revisión editorial.

La biblioteca recibe únicamente entradas publicadas y permite búsqueda textual
y filtros encadenados por **Nivel → Grado → Curso**. Las opciones descendientes
se recalculan al cambiar un filtro para no ofrecer combinaciones inexistentes.

## Sesiones anónimas controladas por el servidor

Una sesión no identifica a una persona y no requiere base de datos. Su estado se
serializa en un token versionado y se firma con HMAC-SHA-256 usando
`AIMAUTA_SESSION_SECRET`. La vigencia es de dos horas.

El estado firmado contiene:

- UUID de sesión, libro, página, ficha y etapa;
- cantidad de intentos distintos y turnos;
- nivel de pista entre 0 y 3;
- revisión monotónica;
- instante de creación y expiración;
- un resumen HMAC del último intento, nunca el texto completo.

El navegador conserva el token v2 en memoria y lo presenta en cada cambio de
página o turno. En cada verificación, el servidor:

1. comprueba estructura, firma, versión y expiración;
2. valida el libro y los límites de página contra el catálogo;
3. vuelve a calcular ficha y etapa desde el currículo;
4. comprueba que la revisión recibida sea la revisión vigente de la sesión;
5. rechaza replay, bifurcaciones y cualquier estado pedagógico inconsistente.

El estado vigente se mantiene en un registro efímero en memoria. Cada mutación
consume la revisión actual y emite la siguiente, lo que serializa cambios de
página y turnos concurrentes. El límite es de 40 turnos por sesión.
Este diseño es intencionalmente **single-instance**: al reiniciar el proceso se
pierde el registro, y varias réplicas no pueden coordinar revisiones sin un
almacén compartido. Por tanto, no existe todavía progreso durable.

Al cambiar de página se reinician intentos, turnos y nivel de pista. En un turno
de texto se cuentan solamente intentos no vacíos distintos; una transcripción
de voz no se cuenta automáticamente como intento. El apoyo aumenta
gradualmente y nunca supera el nivel 3.

El token es íntegro, pero no está cifrado. Debe tratarse como una credencial
efímera: no se registra, no se incluye en analítica y no se entrega a servicios
ajenos al flujo de LiveKit.

### Límites de admisión

Antes de ejecutar trabajo costoso, las rutas públicas aplican ventanas en
memoria:

| Operación | Clave | Límite |
| --- | --- | ---: |
| turnos de `/api/tutor` y del worker | sesión | 12 por minuto |
| accesos de `/api/livekit/token` | sesión | 6 por minuto |
| navegación de `/api/session` | sesión | 60 por minuto |
| sesiones nuevas de `/api/session` | fingerprint del cliente | 12 por minuto |

El fingerprint de creación usa un hash de la dirección proporcionada por un
proxy confiable; sin esa integración, todas las altas comparten un bucket
conservador para no confiar en datos falsificables.
`AIMAUTA_TRUST_PROXY_HEADERS=true` solo debe activarse detrás de un proxy que
elimine `CF-Connecting-IP`, `X-Real-IP` y `X-Forwarded-For` suministradas por el
cliente y escriba su propio valor canónico. Estos límites en memoria reducen
abuso accidental, pero son single-instance; el bucket compartido no es apto
para una clase y tampoco sustituye un límite adicional en el edge o proxy.

## Currículos versionados de ocho fichas

En ambos materiales, las páginas 1 a 12 se consideran orientación (`Explora`).
Las páginas 13 a 100 se dividen en ocho fichas y tres etapas.

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

Cada currículo declara una versión independiente del código del extractor. Esa
versión queda fijada en el índice y debe coincidir con el despliegue que lo
consume.

`Construimos` y `Comprobamos` permiten el tutor. En `Evaluamos`, el alumno puede
leer y escribir, pero la ayuda se bloquea en varias capas:

- la interfaz deshabilita revisión, chat y voz;
- `tutor-service` devuelve el modo `assessment-locked` sin consultar RAG ni
  Ollama;
- el recuperador excluye fragmentos de páginas `Evaluamos` aunque estén dentro
  de la ventana de páginas vecinas de una consulta habilitada;
- el nivel de pista se fuerza a 0;
- `/api/livekit/token` rechaza la creación del canal de voz con HTTP 423.

La navegación hacia una página de evaluación no acredita por sí misma que la
ficha fue completada; el bloqueo implementado protege la resolución autónoma,
no es todavía un sistema de calificación o prerrequisitos persistentes.

## Un solo tutor para texto y voz

`lib/tutor-service.ts` expone la operación central `guideLearningTurn`. Tanto
`/api/tutor` como `/api/internal/turn` la invocan. Esa operación:

1. verifica la sesión firmada y aplica el límite de admisión;
2. aplica el bloqueo de evaluación;
3. recupera evidencia del libro y la página antes de consumir la revisión;
4. evoluciona la sesión y calcula la política;
5. pide a Gemma elegir una de cinco etiquetas pedagógicas cerradas;
6. renderiza en servidor la pregunta aprobada o usa una guía determinista de
   respaldo;
7. devuelve la nueva sesión, actividad, citas y política.

Las etiquetas permitidas son `OBSERVA`, `REFORMULA`, `COMPARA`, `COMPRUEBA` y
`DIVIDE`, con un máximo de 12 tokens internos. La salida cruda de Gemma nunca se
muestra al alumno: una coincidencia exacta selecciona una plantilla
determinista del servidor y cualquier otro contenido se descarta. El guard
formal valida además que la plantilla tenga una sola pregunta y no contenga
patrones de solución. Toda selección sobre el libro usa la evidencia
recuperada. El texto del PDF se delimita como información no confiable para que
sus posibles instrucciones no sustituyan la política.

El endpoint interno exige
`Authorization: Bearer <AIMAUTA_AGENT_SECRET>` y compara el secreto en tiempo
constante. El secreto debe ser independiente del secreto HMAC de las sesiones.

## Canal de voz

### Creación de sala y dispatch

`POST /api/livekit/token` acepta únicamente una sesión HMAC válida y disponible
para tutoría. El servidor crea o actualiza una sala
`aimauta-<sessionId>`, incorpora metadata canónica y emite un JWT de estudiante
por 15 minutos.

Al crear la sala solicita un dispatch nombrado exactamente:

```text
aimauta-socratic-tutor
```

El worker se registra con el mismo nombre. Esta coincidencia es parte del
contrato de despliegue; un nombre distinto deja la sala sin agente.

La metadata visible de la sala contiene contexto operativo mínimo
—identificador de sesión, libro, página y modo—, nunca el token HMAC. La
credencial inicial se incluye en metadata de dispatch dirigida al worker y
procesada por el plano de control de LiveKit. Después, navegador y worker
intercambian revisiones mediante paquetes de datos fiables de LiveKit. El
worker acepta contexto solo desde la identidad exacta `student-<sessionId>` y
el navegador acepta actualizaciones solo del participante agente esperado.

La conexión WebRTC por sí sola no habilita el micrófono. El navegador espera un
participante con `isAgent=true`, identidad `agent-*` y atributo
`lk.agent.name=aimauta-socratic-tutor`; recién entonces activa audio y
micrófono. Si ese agente no aparece en 12 segundos, se retira o se desconecta la
sala, la activación falla de forma cerrada y se limpian conexión, pistas de
audio y micrófono.

### Avatar y audio remoto

La interfaz solo adjunta y analiza pistas de audio pertenecientes al agente que
supera las tres comprobaciones del contrato: `isAgent=true`, identidad
`agent-*` y atributo `lk.agent.name=aimauta-socratic-tutor`. Una pista de otro
participante no puede reproducirse ni controlar el avatar.

Al activar la voz, el navegador carga de forma diferida Three.js y un GLB
sintético CC0 alojado por la propia aplicación. Un `AnalyserNode` calcula
únicamente el nivel RMS de la pista ya autorizada y anima localmente sus
morph-targets; no genera una transcripción adicional ni transmite biometría,
cámara o video. `Permissions-Policy` permite micrófono solo al mismo origen y
bloquea cámara, captura de pantalla y geolocalización. El render se limita a 30
FPS, libera WebGL y Web Audio al cerrar la voz, y cae a un SVG local si falla
WebGL, el modelo o la carga dinámica.
`prefers-reduced-motion` mantiene únicamente el respaldo sin animación.

### Datos de sincronización

El audio viaja por WebRTC. El estado pedagógico se sincroniza con paquetes de
datos fiables y versionados:

| Dirección | Tópico | Carga |
| --- | --- | --- |
| navegador → worker | `aimauta.context.v1` | `{"v":1,"sessionToken":"…"}` |
| worker → navegador | `aimauta.session.v1` | token nuevo, sesión y actividad |

El navegador valida versión, identificador de sesión, revisión, etapa, páginas,
forma e identidad de origen antes de aplicar una actualización. El backend
anti-replay sigue siendo la autoridad cuando texto, navegación y voz compiten
por evolucionar la misma sesión.

### Worker sin LLM propio

El worker de `services/voice-agent` usa esta secuencia:

```text
Silero VAD
  └─► Deepgram STT
        └─► POST /api/internal/turn
              └─► tutor-service ─► RAG ─► Ollama/Gemma o respaldo
        ◄──────────────── respuesta aprobada
  ◄─ Deepgram TTS
```

`AgentSession` se inicia con `record=False`, por lo que Agent Insights no graba
ni sube audio, transcripciones, trazas o logs de la sesión. El nivel de log del
worker es `WARN` y sus mensajes propios redactan credenciales y contenido. Su
health server escucha solamente en `127.0.0.1`, incluso cuando el contenedor usa
la red del host; no debe publicarse mediante el proxy ni el firewall. Un
deadline autoritativo de diez minutos cierra el job y `delete_room_on_close`
elimina la sala, desconectando también al navegador y deteniendo el micrófono.

No habilitar grabación u observabilidad no elimina el tratamiento: el LiveKit
self-hosted procesa el transporte WebRTC y Deepgram procesa
audio/transcripciones para STT y TTS. Antes de trabajar con menores se requieren
consentimiento aplicable, un acuerdo de tratamiento con Deepgram y decisiones
explícitas de retención y eliminación para la infraestructura operada.

La sesión de LiveKit se configura con `llm=None`. El worker no construye
prompts, no consulta RAG y no llama a Ollama. Su responsabilidad es transcribir,
autenticar la llamada interna, publicar la sesión actualizada y sintetizar la
respuesta. Si el backend pedagógico falla, reproduce un mensaje breve de
indisponibilidad sin inventar una pista.

## Contenido, integridad y RAG

La ruta de materiales busca primero el PDF en `AIMAUTA_CONTENT_DIR`. Si no
existe, responde de forma cerrada. El proxy remoto es una opción explícita,
deshabilitada por defecto, y aun habilitado solo acepta URLs oficiales
incluidas en la lista permitida.

`npm run content:sync` comprueba dominio y ruta, tipo PDF, firma `%PDF-`, tamaño
y SHA-256 antes de publicar el archivo. Impone tiempo máximo y límite de bytes,
y escribe de forma atómica un manifiesto runtime v2 acumulativo con fuente,
tamaño, checksum y fecha de sincronización por libro.

`npm run content:index` vuelve a verificar el checksum, extrae texto por
página, comprueba el total de páginas y genera un índice v2 con:

- versión del contrato y del extractor;
- checksum del PDF, taxonomía y número de páginas;
- versión curricular;
- licencia y atribución;
- etapa y ficha de cada fragmento;
- marca `teacherOnly`;
- reporte de páginas sin texto, conteos atípicos y posibles fragmentos
  reservados para docentes.

La carga del índice comprueba límites de tamaño y estructura, exige que
checksum, taxonomía y currículo coincidan con el catálogo actual, valida la
presencia de licencia y contrasta las estadísticas derivables de páginas sin
texto y material docente. Los índices incompatibles fallan de forma cerrada;
la memoria caché se invalida por tamaño y fecha de modificación.

La recuperación léxica combina coincidencia con la consulta, cercanía a la
página visible y un refuerzo pequeño para ejercicios. Está acotada al libro y
a la ficha firmados en la sesión, a una ventana de dos páginas, y excluye tanto
`Evaluamos` como los fragmentos `teacherOnly`. Devuelve citas de página. Un
índice vectorial puede reemplazar el ranking en otra iteración sin cambiar el
contrato del tutor.

Los dos PDFs se importan únicamente desde el Repositorio Institucional del
MINEDU. `librosescolaresperu.com` participa solo en el descubrimiento y no es
fuente de descarga, metadatos canónicos ni evidencia de licencia.

## Límites de confianza

```text
Internet público
  ├─ navegador: entrada no confiable
  ├─ LiveKit self-hosted: WSS, SFU y TURN administrados por el equipo
  └─ Deepgram: STT/TTS con credencial exclusiva del worker

PowerEdge
  ├─ Next.js: autoridad de sesión, currículo y tutor
  ├─ LiveKit Server + Caddy L4: señalización, SFU y TURN sin grabación
  ├─ worker: adaptador de voz sin LLM
  ├─ PDFs autorizados
  └─ índices reproducibles

Canal privado PowerEdge–Aule
  └─ SSH sobre la tailnet: 127.0.0.1:11435 → Ollama 127.0.0.1:11434
```

Ollama nunca escucha en `0.0.0.0` ni se publica mediante Tailscale Funnel. Las
credenciales de LiveKit y Deepgram pertenecen exclusivamente a AImauta; no se
reutilizan las de Nebu u otros servicios. El secreto de Deepgram solo existe en
el worker, y los secretos de API de LiveKit nunca se entregan al navegador.

La aplicación no persiste conversaciones, progreso ni analítica individual. El
registro anti-replay conserva únicamente el estado mínimo de la sesión en
memoria y desaparece al reiniciar. La instancia LiveKit procesa en memoria el
audio necesario para transportarlo, y Deepgram procesa audio y transcripciones
para operar STT/TTS; antes de un piloto con menores se deben definir
consentimiento, DPA, retención y eliminación aplicables.
