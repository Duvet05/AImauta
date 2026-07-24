# AImauta

AImauta es un espacio de aprendizaje guiado para estudiantes escolares del
Perú. Mantiene el material visible, pide al estudiante que escriba o explique su
intento y usa un tutor socrático para ofrecer una pregunta o una pista breve,
sin resolver el ejercicio por él.

## Estado de la segunda iteración

El recorrido vertical actual incluye:

1. un catálogo de materiales autorizados y un visor PDF **same-origin**;
2. sesiones anónimas con estado pedagógico firmado mediante HMAC y validado por
   el servidor;
3. las ocho fichas de **Fichas de Matemática 1**, divididas en las etapas
   `Construimos`, `Comprobamos` y `Evaluamos`;
4. un único servicio de tutoría para texto y voz, con RAG por página, política
   socrática y respaldo conservador cuando Ollama no responde;
5. un canal de voz opcional con LiveKit, Deepgram y un worker preparado para
   ejecutarse en PowerEdge.

Durante `Evaluamos`, el estudiante conserva el PDF y su espacio de respuesta,
pero el chat, las pistas y la voz quedan bloqueados. La restricción se valida
también en el servidor: no depende únicamente de la interfaz.

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

## Voz con LiveKit

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
expone su health check únicamente en `127.0.0.1`. Esto desactiva la grabación de
Agent Insights, pero no elimina el tratamiento necesario para prestar el
servicio: LiveKit y Deepgram siguen procesando audio y transcripciones en
tránsito. Un piloto con estudiantes requiere consentimiento aplicable, acuerdos
de tratamiento con los proveedores y una política explícita de retención y
eliminación.

Deepgram realiza STT y TTS; Silero aporta detección de voz. El worker llama a
`POST /api/internal/turn` con un secreto de servicio y no se conecta
directamente a Ollama.

## Primer material autorizado

El catálogo inicial contiene **Fichas de Matemática 1**, del Ministerio de
Educación del Perú:

- ficha oficial:
  [Repositorio Institucional del MINEDU, handle 10834](https://repositorio.minedu.gob.pe/handle/20.500.12799/10834);
- licencia verificada:
  [Creative Commons Atribución 4.0](https://creativecommons.org/licenses/by/4.0/);
- procedencia de descubrimiento:
  `librosescolaresperu.com`;
- procedencia de importación: exclusivamente la descarga oficial del MINEDU.

El sitio de terceros se usa para descubrir materiales, no como fuente de
descarga ni como evidencia de licencia.

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
```

Secuencia resumida en PowerEdge:

```bash
cd /home/hii1sc/aimauta-build
npm ci
AIMAUTA_CONTENT_DIR=/home/hii1sc/aimauta-runtime/content npm run content:sync
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

La configuración parte de `.env.example`. En producción son obligatorios dos
secretos aleatorios e independientes de al menos 32 caracteres:
`AIMAUTA_SESSION_SECRET` y `AIMAUTA_AGENT_SECRET`.

Ollama permanece en loopback en Aule. La conexión recomendada desde PowerEdge
es un túnel SSH que publique únicamente
`http://127.0.0.1:11435` en PowerEdge. No se debe usar Tailscale Funnel ni
configurar Ollama en `0.0.0.0`.

LiveKit y Deepgram deben usar proyectos o claves dedicados a AImauta, separados
de Nebu y de cualquier otro sistema. Los secretos permanecen únicamente en los
servicios de PowerEdge.

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
