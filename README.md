# AImauta

AImauta es un espacio de aprendizaje guiado para estudiantes escolares del
Perú. Mantiene el material visible, pide al estudiante que escriba o explique su
intento y usa un tutor socrático para ofrecer una pregunta o una pista breve,
sin resolver el ejercicio por él.

## Estado de la iteración de biblioteca curricular

El recorrido vertical actual incluye:

1. un catálogo v2 con taxonomía normalizada, publicación **fail-closed** y
   filtros encadenados por nivel, grado y curso;
2. un visor **same-origin** basado en PDF.js, con texto seleccionable,
   navegación, zoom y un `iframe` nativo únicamente como respaldo;
3. dos materiales oficiales de Matemática, cada uno con currículo versionado
   de ocho fichas y cobertura completa de páginas;
4. sesiones anónimas con estado pedagógico firmado mediante HMAC y validado por
   el servidor;
5. un único servicio de tutoría para texto y voz, con RAG por página, política
   socrática y respaldo conservador cuando Ollama no responde;
6. un canal de voz opcional con LiveKit Cloud Inference y un worker
   autohospedado en PowerEdge;
7. un avatar 3D local que reacciona al audio aprobado del tutor, con una
   ilustración SVG accesible como respaldo.

Solo los materiales con estado `published` llegan al navegador. Toda entrada,
incluso en `draft`, `review` o `disabled`, debe fijar tamaño y SHA-256. Para
publicarse debe tener además fuente oficial permitida, licencia y atribución
revisadas, taxonomía válida y exactamente un currículo versionado, con al menos
una unidad y cobertura íntegra sin huecos ni solapamientos. Cualquier estado o
clasificación curricular desconocida se trata como no disponible.

La ayuda se habilita exclusivamente en secciones `learn` y `practice`.
`orientation`, las páginas no clasificadas y `assessment` no consultan RAG ni
habilitan texto o voz. Durante `Evaluamos`, el estudiante conserva el PDF y su
espacio de respuesta. La restricción se valida también en el servidor: no
depende únicamente de la interfaz.

La recuperación de evidencia excluye además cualquier fragmento perteneciente
a páginas `Evaluamos`, incluso cuando esté cerca de una página habilitada.
Gemma no redacta el texto que ve el estudiante: elige una etiqueta dentro de
cinco movimientos pedagógicos cerrados y el servidor renderiza una pregunta
aprobada. Cualquier salida distinta se descarta y activa una pregunta de
respaldo determinista.

## Flujo

```text
Texto: navegador ──► /api/tutor ────────────────┐
                                                   ├─► tutor-service
Voz:   navegador ──► LiveKit ──► worker STT ──► /api/internal/turn
                                                   │
                                                   ├─► RAG por página
                                                   ├─► Ollama + Gemma
                                                   └─► guía segura de respaldo

       navegador ◄── LiveKit ◄── worker TTS ◄──── respuesta socrática
```

El worker de voz no contiene otro LLM ni otra política pedagógica. Convierte
voz a texto, solicita el turno al mismo `tutor-service` usado por el chat y
convierte la respuesta aprobada a voz.
Una transcripción oral se registra como turno, pero no se considera
automáticamente un intento de resolución; así, preguntas como «no entiendo» no
elevan artificialmente el contador de intentos.

## Sesiones pedagógicas

`POST /api/session` emite un token anónimo v2, firmado con HMAC-SHA-256 y válido
por dos horas. El token lleva el libro, la página, la etapa, una revisión
monotónica, los contadores de intentos y turnos y el nivel de pista. El servidor
vuelve a calcular la ficha y la etapa desde su currículo, rechaza firmas
alteradas o vencidas y no acepta estado pedagógico inventado por el cliente.

Cada revisión aceptada se registra temporalmente en memoria para impedir el
replay de tokens anteriores y serializar los cambios de página y los turnos.
Una sesión admite como máximo 40 turnos. Este registro es deliberadamente
efímero: funciona solo dentro de una instancia de Next.js, se pierde al
reiniciar y no constituye progreso durable ni coordinación multiinstancia.

El token está firmado, no cifrado, y funciona como credencial de sesión: no
debe registrarse ni enviarse fuera del flujo previsto. La implementación actual
no crea cuentas, no persiste conversaciones y no incluye el texto completo del
intento en el token.

Las rutas públicas limitan cada sesión a 12 turnos de tutor y 6 activaciones de
voz por minuto; la creación se limita a 12 sesiones nuevas por minuto y
fingerprint del cliente. También se requiere un límite adicional en el proxy o
edge. Por defecto no se confía en cabeceras de proxy;
`AIMAUTA_TRUST_PROXY_HEADERS=true` solo es seguro cuando el proxy elimina las
cabeceras de forwarding aportadas por el cliente y escribe valores canónicos
propios. Sin esa integración, todas las altas comparten un bucket conservador:
es un modo cerrado para desarrollo, no una configuración utilizable por una
clase ni un reemplazo del control del edge.

## Avatar y voz con LiveKit

El avatar visual y la voz tienen controles independientes y cerrados por
defecto. `AIMAUTA_AVATAR_ENABLED=true` permite una vista previa local únicamente
cuando la URL de aprendizaje incluye `?avatar=1`. Sin ese parámetro no se
renderiza ni descarga el modelo.

`AIMAUTA_VOICE_TUTOR_ENABLED=true` habilita por separado el micrófono y la
emisión de tokens LiveKit. La interfaz de voz también requiere `?avatar=1`;
el parámetro por sí solo nunca habilita una capacidad apagada en el servidor.
Mientras ambas funciones están ocultas, el PDF, el intento y el tutor RAG de
texto siguen disponibles.

La API crea una sala por sesión y solicita explícitamente el agente nombrado:

```text
aimauta-socratic-tutor
```

El navegador y el worker sincronizan el token pedagógico mediante paquetes
fiables con estos tópicos versionados:

```text
aimauta.context.v1
aimauta.session.v1
```

La metadata de sala no contiene la credencial pedagógica. El token inicial se
incluye en metadata de dispatch dirigida al worker —y procesada por el plano de
control de LiveKit—; las revisiones posteriores viajan en paquetes de datos
fiables dentro de la sala y se aceptan solo desde las identidades exactas
esperadas.

La interfaz considera lista la voz únicamente cuando aparece el participante
agente esperado —marcado por LiveKit, con identidad `agent-*` y atributo
`lk.agent.name=aimauta-socratic-tutor`—. Hasta entonces mantiene el micrófono
apagado; si el agente no llega en 12 segundos o abandona la sala, cierra la
conexión y limpia audio y micrófono.

El worker inicia `AgentSession` con `record=False`, usa logging `WARN` con
redacción, limita cada conexión a diez minutos, elimina la sala al terminar y
expone su health check únicamente en `127.0.0.1`. LiveKit Cloud transporta la
sesión y LiveKit Inference ejecuta STT/TTS con Deepgram bajo retención cero por
defecto. No se habilita Agent Observability, grabación, Ingress, Egress ni SIP.
Un piloto con estudiantes requiere igualmente consentimiento aplicable,
revisión contractual y una política explícita de retención y eliminación.

LiveKit Inference usa Deepgram Nova-3 y Aura-2; Silero aporta detección de voz.
El worker llama a `POST /api/internal/turn` con un secreto de servicio y no se
conecta directamente a Ollama.

## Avatar local y privado

El navegador carga bajo demanda un personaje 3D sintético CC0 de MakeHuman y
lo renderiza con Three.js, que usa licencia MIT. No solicita cámara, no publica
video y la política de permisos HTTP bloquea explícitamente cámara,
captura de pantalla y geolocalización. No se envían rasgos, imágenes ni audio a
un proveedor de avatar. La animación de la boca se calcula localmente con el
nivel del audio remoto y solo acepta la pista del participante agente validado.

Si WebGL no está disponible, el modelo no carga o el estudiante prefiere
movimiento reducido, permanece una ilustración SVG local con los mismos estados
de conexión. La procedencia, licencia, optimización y checksums del modelo se
conservan en [`public/avatars/README.md`](public/avatars/README.md).

## Biblioteca curricular y visor

El catálogo público contiene dos cuadernos del Ministerio de Educación del
Perú. Ambos corresponden a la primera reimpresión de setiembre de 2024 y
registran licencia
[Creative Commons Atribución 4.0](https://creativecommons.org/licenses/by/4.0/):

| Material | Ficha oficial | Tamaño fijado | SHA-256 |
| --- | --- | ---: | --- |
| Fichas de Matemática 1 | [MINEDU 10834](https://repositorio.minedu.gob.pe/handle/20.500.12799/10834) | 32 895 443 bytes | `c220ec82ed676a813977d61afea236e761c5253ef0beb0b0de9afccaf2eeaac0` |
| Fichas de Matemática 2 | [MINEDU 10835](https://repositorio.minedu.gob.pe/handle/20.500.12799/10835) | 31 997 485 bytes | `c5c116ed7c6f091630e39d1cbeb0aa6fa2095157734daa33c5eb58ae470089a0` |

`librosescolaresperu.com` se usa únicamente para descubrir materiales. La
importación usa exclusivamente la descarga oficial del MINEDU; los metadatos
canónicos y la evidencia de licencia proceden de la ficha oficial, y la
identidad de la edición se contrasta con el PDF.

La biblioteca permite buscar y filtrar en cascada por
**Nivel → Grado → Curso**. Al abrir un material, PDF.js renderiza el archivo
local servido por `/api/materials/:bookId/pdf`, con su worker alojado por la
propia aplicación y una capa de texto seleccionable. El `iframe` nativo se
activa solo si el render de PDF.js falla de forma definitiva o repetida.

La sincronización publica además un manifiesto runtime v2 acumulativo y
atómico. La indexación genera un índice v2 ligado al checksum, taxonomía,
versión curricular y licencia; su reporte de calidad señala páginas sin texto,
valores atípicos y posibles fragmentos reservados para docentes. Los índices
incompatibles o malformados se rechazan antes de recuperar evidencia.

## Ejecución y compilación

Las instalaciones, la sincronización de contenido, la indexación, las pruebas,
la compilación de Next.js y la imagen del worker se ejecutan
**exclusivamente en PowerEdge**. La Mac se usa para edición y control de
versiones.

Rutas operativas:

```text
/home/hii1sc/aimauta-build
/home/hii1sc/aimauta-runtime/content
/home/hii1sc/aimauta-runtime/indexes
/home/hii1sc/aimauta-runtime/manifests
```

Secuencia resumida en PowerEdge:

```bash
cd /home/hii1sc/aimauta-build
npm ci
npm run catalog:validate
AIMAUTA_CONTENT_DIR=/home/hii1sc/aimauta-runtime/content \
  AIMAUTA_MANIFEST_DIR=/home/hii1sc/aimauta-runtime/manifests \
  npm run content:sync
AIMAUTA_CONTENT_DIR=/home/hii1sc/aimauta-runtime/content \
  AIMAUTA_INDEX_DIR=/home/hii1sc/aimauta-runtime/indexes \
  npm run content:index
npm run lint
npm run typecheck
npm test
AIMAUTA_CONTENT_DIR=/home/hii1sc/aimauta-runtime/content \
  AIMAUTA_INDEX_DIR=/home/hii1sc/aimauta-runtime/indexes \
  npm run build
docker build -t aimauta-voice-agent:local services/voice-agent
```

`npm run build` vuelve a ejecutar automáticamente `catalog:validate` como
puerta previa; no puede compilar un catálogo curricular inválido.

La configuración parte de `.env.example`. En producción son obligatorios dos
secretos aleatorios e independientes de al menos 32 caracteres:
`AIMAUTA_SESSION_SECRET` y `AIMAUTA_AGENT_SECRET`.

Ollama permanece en loopback en Aule. La conexión recomendada desde PowerEdge
es un túnel SSH que publique únicamente
`http://127.0.0.1:11435` en PowerEdge. No se debe usar Tailscale Funnel ni
configurar Ollama en `0.0.0.0`.

El proyecto LiveKit Cloud y sus credenciales deben ser dedicados a AImauta,
separados de Nebu y de cualquier otro sistema. Los secretos permanecen
únicamente en los servicios de PowerEdge. La alternativa self-hosted está
documentada en [`infra/livekit`](infra/livekit/README.md), pero el worker Cloud
actual requeriría otro adaptador STT/TTS para usarla.

## Límites de contenido y datos

- No se versionan PDFs, índices extraídos ni manifiestos generados.
- No se importa un material sin una ficha oficial del MINEDU y una licencia
  verificada que permita el uso previsto.
- No se guardan en Git conversaciones, intentos, nombres ni otros datos de
  menores de edad.
- Una autorización de rastreo o un enlace público no equivale a una licencia de
  redistribución.

## Documentación

- [Arquitectura](docs/ARCHITECTURE.md)
- [Política de contenidos](docs/CONTENT_POLICY.md)
- [Despliegue en PowerEdge](docs/DEPLOYMENT.md)
