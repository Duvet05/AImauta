# Despliegue en PowerEdge

## Regla de ejecución

Las dependencias, la sincronización de PDFs, la generación de índices, las
pruebas, la compilación de Next.js y la construcción de la imagen del worker se
ejecutan exclusivamente en PowerEdge. La Mac se usa para edición y control de
versiones; no se ejecutan allí `npm ci`, builds, pruebas, instalaciones de
Python ni `docker build`.

Todos los comandos de esta guía se ejecutan en PowerEdge, salvo que se indique
expresamente que corresponden a Aule o a una consola de proveedor.

## Topología

- **PowerEdge:** Next.js, PDFs, índices/RAG y worker de LiveKit.
- **Aule:** Ollama con Gemma, escuchando solamente en loopback.
- **LiveKit Cloud:** señalización, SFU, TURN y dispatch del piloto de voz.
- **Deepgram:** STT y TTS del worker.
- **Tailscale + SSH:** canal privado PowerEdge–Aule para Ollama.

Los colegas acceden a la aplicación por el proxy HTTPS y a LiveKit por WebRTC;
no necesitan pertenecer a la tailnet. Ollama no se publica en Internet.

## Rutas

```text
Código y build:       /home/hii1sc/aimauta-build
PDFs:                 /home/hii1sc/aimauta-runtime/content
Índices:              /home/hii1sc/aimauta-runtime/indexes
Entorno del worker:   /home/hii1sc/aimauta-runtime/voice-agent.env
Entorno de pruebas:   /home/hii1sc/aimauta-runtime/voice-test-venv
```

Los directorios de runtime sobreviven a una actualización y no están dentro del
repositorio.

## Requisitos

- PowerEdge con Git, Node.js 22 o superior, npm y Docker Engine.
- Python 3.12 o 3.13 en PowerEdge para ejecutar las pruebas del worker.
- Tailscale y acceso SSH por llave desde PowerEdge hacia Aule.
- Ollama y `gemma4:e4b-it-qat` instalados en Aule.
- Un proyecto y credenciales de LiveKit dedicados a AImauta.
- Una clave de Deepgram dedicada a AImauta.
- Un proxy HTTPS administrado delante de Next.js.

No se reutilizan proyectos, API keys ni secretos de Nebu, SIHSALUS u otros
sistemas.

## Preparación inicial

En PowerEdge:

```bash
install -d -m 0750 \
  /home/hii1sc/aimauta-build \
  /home/hii1sc/aimauta-runtime/content \
  /home/hii1sc/aimauta-runtime/indexes

git clone git@github.com:Duvet05/AImauta.git \
  /home/hii1sc/aimauta-build

cd /home/hii1sc/aimauta-build
npm ci
```

Si el clon ya existe, se actualiza con un avance `fast-forward` de la rama
aprobada. No se reemplazan archivos de runtime al actualizar el código.

## Canal privado hacia Ollama

La opción recomendada es mantener Ollama en
`127.0.0.1:11434` de Aule y abrir desde PowerEdge un túnel SSH limitado al
loopback local:

```bash
ssh -NT \
  -o ExitOnForwardFailure=yes \
  -o ServerAliveInterval=30 \
  -o ServerAliveCountMax=3 \
  -L 127.0.0.1:11435:127.0.0.1:11434 \
  aule
```

`aule` debe ser un alias SSH configurado en PowerEdge, autenticado por llave y
alcanzable dentro de Tailscale. El túnel se registra con el administrador de
servicios del host para que reinicie ante una caída; debe ejecutarse con el
usuario de servicio de AImauta y sin contraseña interactiva.

En el PowerEdge actual, la unidad de usuario se encuentra en:

```text
/home/hii1sc/.config/systemd/user/aimauta-aule-ollama-tunnel.service
```

La unidad ya está habilitada y reinicia el túnel ante fallas. Para que arranque
después de un reinicio incluso antes del primer inicio de sesión de `hii1sc`, un
administrador debe habilitar una vez el *linger* del usuario:

```bash
sudo loginctl enable-linger hii1sc
```

Comprobar desde PowerEdge:

```bash
curl --fail http://127.0.0.1:11435/api/tags
```

La aplicación usa:

```dotenv
OLLAMA_BASE_URL=http://127.0.0.1:11435
```

No se usa Tailscale Funnel para Ollama, no se abre el puerto 11434 en el proxy
público y no se configura `OLLAMA_HOST=0.0.0.0`. El enlace queda:

```text
PowerEdge 127.0.0.1:11435
  └─ SSH sobre Tailscale
       └─ Aule 127.0.0.1:11434
```

## Secretos dedicados

Generar en PowerEdge dos valores aleatorios e independientes, cada uno de al
menos 32 caracteres:

```bash
openssl rand -base64 48
openssl rand -base64 48
```

- `AIMAUTA_SESSION_SECRET` firma el estado anónimo con HMAC.
- `AIMAUTA_AGENT_SECRET` autentica únicamente al worker ante
  `/api/internal/turn`.

El token v2 incluye una revisión monotónica y el contador de turnos. Next.js
conserva en memoria la revisión vigente para rechazar replay y comprueba en el
token el límite de 40 turnos. El registro se pierde al reiniciar y no funciona
entre réplicas sin un almacén compartido; el despliegue documentado es de una
sola instancia y no ofrece progreso durable.

Desde las consolas de los proveedores:

- crear un proyecto de LiveKit exclusivo para AImauta y obtener URL, API key y
  API secret;
- crear una clave de Deepgram exclusiva para AImauta, con cuota y rotación
  propias;
- si LiveKit permite separar identidades dentro del mismo proyecto, usar un par
  de credenciales para la API web y otro para el worker.

Los secretos no se imprimen en comandos de diagnóstico, no se registran en logs
y no se incorporan a Git.

## Entorno de Next.js

Crear `/home/hii1sc/aimauta-build/.env.local`:

```dotenv
AIMAUTA_CONTENT_DIR=/home/hii1sc/aimauta-runtime/content
AIMAUTA_INDEX_DIR=/home/hii1sc/aimauta-runtime/indexes
AIMAUTA_REMOTE_CONTENT_PROXY=false

AIMAUTA_SESSION_SECRET=valor-aleatorio-exclusivo-de-sesion
AIMAUTA_AGENT_SECRET=valor-aleatorio-exclusivo-del-worker
AIMAUTA_TRUST_PROXY_HEADERS=true

OLLAMA_BASE_URL=http://127.0.0.1:11435
OLLAMA_MODEL=gemma4:e4b-it-qat
OLLAMA_TIMEOUT_MS=45000

LIVEKIT_URL=wss://proyecto-aimauta.livekit.cloud
LIVEKIT_API_URL=https://proyecto-aimauta.livekit.cloud
LIVEKIT_API_KEY=clave-api-web-de-aimauta
LIVEKIT_API_SECRET=secreto-api-web-de-aimauta
```

`LIVEKIT_API_URL` puede derivarse de `LIVEKIT_URL`, pero se recomienda
declararla para que el destino administrativo sea explícito. `DEEPGRAM_API_KEY`
no pertenece al proceso web.

Aplicar permisos restringidos:

```bash
chmod 600 /home/hii1sc/aimauta-build/.env.local
```

`AIMAUTA_REMOTE_CONTENT_PROXY=false` obliga al visor a usar el PDF local
sincronizado y verificado.

El despliegue público documentado exige que el proxy elimine
`CF-Connecting-IP`, `X-Real-IP` y `X-Forwarded-For` recibidas del cliente y
escriba un valor canónico propio; por eso configura
`AIMAUTA_TRUST_PROXY_HEADERS=true`. Si el proxy no puede garantizarlo, no se
publica todavía y se conserva `false`: en ese modo todas las altas comparten un
bucket cerrado que sirve para desarrollo, no para una clase. El límite
principal y distribuido debe vivir en el proxy.

## Entorno del worker

Crear `/home/hii1sc/aimauta-runtime/voice-agent.env`:

```dotenv
LIVEKIT_URL=wss://proyecto-aimauta.livekit.cloud
LIVEKIT_API_KEY=clave-api-worker-de-aimauta
LIVEKIT_API_SECRET=secreto-api-worker-de-aimauta
DEEPGRAM_API_KEY=clave-deepgram-de-aimauta

AIMAUTA_APP_URL=http://127.0.0.1:3000
AIMAUTA_AGENT_SECRET=el-mismo-valor-configurado-en-nextjs

REQUEST_TIMEOUT_SECONDS=50
STT_MODEL=nova-3
STT_LANGUAGE=es
TTS_MODEL=aura-2-selena-es
MAX_SESSION_SECONDS=600
```

`AIMAUTA_AGENT_SECRET` es el único **secreto propio de AImauta** compartido
entre ambos procesos. Ambos también conocen `LIVEKIT_URL` y se autentican ante
el mismo proyecto de LiveKit, idealmente con pares de credenciales distintos.
El worker no recibe `OLLAMA_BASE_URL`, `OLLAMA_MODEL`,
`AIMAUTA_SESSION_SECRET` ni acceso a los índices.

Aplicar permisos:

```bash
chmod 600 /home/hii1sc/aimauta-runtime/voice-agent.env
```

El código inicia LiveKit Agents con `record=False`; Agent Insights no debe
grabar ni subir audio, transcripciones, trazas o logs. `WARN` reduce el logging
operativo y los mensajes propios del worker están redactados, pero esto no
elimina el tratamiento necesario del servicio: LiveKit transporta el audio y
Deepgram procesa audio/transcripciones para STT y TTS. Antes de habilitar voz
para menores deben existir consentimiento aplicable, DPA con los proveedores y
una política verificada de retención y eliminación.

`MAX_SESSION_SECONDS=600` corta STT/TTS y el job aunque el navegador permanezca
conectado. El worker elimina la sala al cerrar; el navegador también aplica el
deadline devuelto por la API y se desconecta si el agente sale.

## Sincronización e indexación

Cada entrada del catálogo debe haber superado
[la política de contenidos](CONTENT_POLICY.md). En PowerEdge:

```bash
cd /home/hii1sc/aimauta-build

AIMAUTA_CONTENT_DIR=/home/hii1sc/aimauta-runtime/content \
  npm run content:sync -- --book fichas-matematica-1-secundaria

AIMAUTA_CONTENT_DIR=/home/hii1sc/aimauta-runtime/content \
  AIMAUTA_INDEX_DIR=/home/hii1sc/aimauta-runtime/indexes \
  npm run content:index
```

La sincronización verifica dominio, firma PDF, tamaño y SHA-256. La indexación
vuelve a comprobar el checksum y el total de páginas. Un fallo detiene el
despliegue; no se omiten estas verificaciones.

## Pruebas y builds

### Aplicación

En PowerEdge:

```bash
cd /home/hii1sc/aimauta-build
npm run lint
npm run typecheck
npm test

AIMAUTA_CONTENT_DIR=/home/hii1sc/aimauta-runtime/content \
  AIMAUTA_INDEX_DIR=/home/hii1sc/aimauta-runtime/indexes \
  npm run build
```

Las pruebas cubren, entre otros contratos, las ocho fichas, la firma, revisión,
anti-replay, expiración y límite de 40 turnos, los rate limits, la exclusión de
`Evaluamos` en RAG, los movimientos pedagógicos cerrados, el endpoint interno y
la indisponibilidad controlada de LiveKit.

### Worker de voz

Crear una vez el entorno de pruebas en PowerEdge:

```bash
python3 -m venv /home/hii1sc/aimauta-runtime/voice-test-venv
/home/hii1sc/aimauta-runtime/voice-test-venv/bin/pip install \
  --require-hashes \
  -r /home/hii1sc/aimauta-build/services/voice-agent/requirements.lock
/home/hii1sc/aimauta-runtime/voice-test-venv/bin/pip install \
  --no-deps \
  -e /home/hii1sc/aimauta-build/services/voice-agent
/home/hii1sc/aimauta-runtime/voice-test-venv/bin/pip install \
  --no-deps \
  --require-hashes \
  -r /home/hii1sc/aimauta-build/services/voice-agent/requirements-test.lock
```

Ejecutar sus pruebas y construir la imagen de producción:

```bash
cd /home/hii1sc/aimauta-build
/home/hii1sc/aimauta-runtime/voice-test-venv/bin/pytest \
  services/voice-agent/tests
docker build -t aimauta-voice-agent:local services/voice-agent
```

`requirements-test.lock` fija también con hashes las herramientas de arranque y
prueba, incluido `pip`, `pytest` y `pytest-asyncio`; se instala sin resolver
dependencias implícitas sobre el lock de runtime. La imagen de producción
instala solamente `requirements.lock`, elimina `pip` del entorno copiado,
excluye pruebas y ejecuta el worker como un usuario sin privilegios. No se
despliega una revisión si falla una comprobación.

## Inicio de servicios

Iniciar Next.js en loopback:

```bash
cd /home/hii1sc/aimauta-build
npm run start -- --hostname 127.0.0.1 --port 3000
```

Iniciar el worker en PowerEdge:

```bash
docker run -d \
  --name aimauta-voice-agent \
  --restart unless-stopped \
  --network host \
  --env-file /home/hii1sc/aimauta-runtime/voice-agent.env \
  aimauta-voice-agent:local
```

`--network host` permite que el contenedor alcance
`AIMAUTA_APP_URL=http://127.0.0.1:3000` sin publicar otro puerto. El proceso se
registra en LiveKit con el nombre exacto `aimauta-socratic-tutor`.
El health server del worker está fijado a `127.0.0.1`; no se debe cambiar a
`0.0.0.0`, publicar su puerto ni añadirlo al proxy. Con red de host, cualquier
escucha en todas las interfaces quedaría expuesta directamente por el
PowerEdge, sujeta únicamente al firewall del host.
Cada job dura como máximo diez minutos y elimina su sala al cerrar; esto corta
el audio del participante y permite que una reactivación cree un dispatch
limpio.

El navegador no considera lista la voz solo porque entró a la sala: exige al
participante con `isAgent=true`, identidad `agent-*` y atributo
`lk.agent.name=aimauta-socratic-tutor`. Mantiene el micrófono apagado hasta
encontrarlo, espera como máximo 12 segundos y limpia conexión, audio y
micrófono si el agente no llega o abandona la sala.

La metadata visible de la sala no lleva el token pedagógico. El token inicial
viaja en metadata de dispatch dirigida al worker y procesada por LiveKit; las
revisiones siguientes usan paquetes de datos LiveKit. El worker vincula esos
paquetes a la identidad exacta `student-<sessionId>`; no se deben relajar esa
comprobación ni los destinos del canal de datos.

El puerto 3000 se publica solamente mediante un proxy HTTPS administrado. Se
recomienda bloquear en el proxy el acceso externo a `/api/internal/turn`; el
worker lo consume directamente por loopback y, además, la ruta exige el bearer
`AIMAUTA_AGENT_SECRET`.

La aplicación limita por sesión a 12 turnos de tutor y 6 accesos de voz por
minuto; la creación se limita a 12 sesiones nuevas por minuto y fingerprint del
cliente. Estos contadores viven en memoria y protegen una sola instancia; el
proxy o edge debe añadir su propio límite distribuido, tamaño máximo de body y
límite de conexiones. No debe reenviar al proceso cabeceras de identidad
aportadas directamente por el cliente.

## Validación posterior

Comprobaciones locales en PowerEdge:

```bash
curl --fail http://127.0.0.1:3000/
curl --fail --head \
  http://127.0.0.1:3000/api/materials/fichas-matematica-1-secundaria/pdf
curl --fail http://127.0.0.1:11435/api/tags
docker logs --tail 100 aimauta-voice-agent
```

Validar desde un navegador HTTPS:

1. abrir **Fichas de Matemática 1** y confirmar que inicia en la página 13;
2. escribir un intento y comprobar que el chat devuelve una sola pista o
   pregunta con cita de página;
3. activar la voz y comprobar que el micrófono permanece apagado hasta que se
   conecta el agente exacto; luego conceder permiso y confirmar un ciclo
   STT → tutor interno → TTS;
4. comprobar que un turno de voz actualiza turnos y nivel de apoyo en la
   interfaz, sin incrementar automáticamente el contador de intentos;
5. navegar a una página `Evaluamos`, por ejemplo la 21, y confirmar que chat,
   revisión y voz quedan bloqueados;
6. comprobar en LiveKit que la sala recibió el dispatch
   `aimauta-socratic-tutor`;
7. comprobar que la metadata de sala no contiene `session_token`, que el worker
   acepta solamente `student-<sessionId>` y que Agent Insights no creó una
   grabación de la sesión.

La validación no debe imprimir tokens pedagógicos, transcripciones,
`AIMAUTA_AGENT_SECRET`, credenciales de LiveKit ni la clave de Deepgram.

## Actualización

En PowerEdge:

```bash
cd /home/hii1sc/aimauta-build
git fetch origin
git switch main
git pull --ff-only origin main
npm ci

/home/hii1sc/aimauta-runtime/voice-test-venv/bin/pip install \
  --require-hashes \
  -r /home/hii1sc/aimauta-build/services/voice-agent/requirements.lock
/home/hii1sc/aimauta-runtime/voice-test-venv/bin/pip install \
  --no-deps \
  --require-hashes \
  -r /home/hii1sc/aimauta-build/services/voice-agent/requirements-test.lock
/home/hii1sc/aimauta-runtime/voice-test-venv/bin/pip install \
  --no-deps \
  -e /home/hii1sc/aimauta-build/services/voice-agent

AIMAUTA_CONTENT_DIR=/home/hii1sc/aimauta-runtime/content \
  AIMAUTA_INDEX_DIR=/home/hii1sc/aimauta-runtime/indexes \
  npm run content:index

npm run lint
npm run typecheck
npm test

AIMAUTA_CONTENT_DIR=/home/hii1sc/aimauta-runtime/content \
  AIMAUTA_INDEX_DIR=/home/hii1sc/aimauta-runtime/indexes \
  npm run build

/home/hii1sc/aimauta-runtime/voice-test-venv/bin/pytest \
  services/voice-agent/tests
docker build -t aimauta-voice-agent:local services/voice-agent
```

La sincronización se repite solo cuando el catálogo incorpora un material o una
edición aprobada. Después se reinician Next.js y el worker mediante el
administrador de servicios del host y se repite la validación posterior.
Reiniciar un contenedor existente no adopta la imagen recién construida: el
administrador debe sustituir el contenedor por otro creado desde la nueva
imagen. El worker no guarda estado durable dentro del contenedor.

## Operación segura

- Mantener activo y supervisado el túnel
  `127.0.0.1:11435 → Aule 127.0.0.1:11434`.
- No usar Funnel ni una escucha `0.0.0.0` para Ollama.
- Mantener `AIMAUTA_REMOTE_CONTENT_PROXY=false` cuando exista la copia local.
- En despliegue público, sanear y reescribir las cabeceras de forwarding en el
  proxy y recién entonces usar `AIMAUTA_TRUST_PROXY_HEADERS=true`.
- Aplicar rate limits adicionales en el edge; los contadores de la aplicación
  son efímeros y single-instance.
- No registrar cuerpos de `/api/tutor` o `/api/internal/turn`.
- Mantener `record=False`, logs `WARN` redactados y el health del worker en
  `127.0.0.1`; no publicar el health aun cuando Docker use `--network host`.
- No respaldar conversaciones ni datos de menores.
- Revisar consentimiento, DPA, retención y eliminación de LiveKit y Deepgram
  antes de habilitar voz para estudiantes.
- Rotar por separado los secretos de sesión, worker, LiveKit y Deepgram ante
  cualquier exposición.
- Regenerar los índices desde el PDF autorizado en vez de tratarlos como datos
  irremplazables.
