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

- **PowerEdge:** Next.js, PDFs, índices/RAG y worker de voz autohospedado.
- **Aule:** Ollama con Gemma, escuchando solamente en loopback.
- **LiveKit Cloud:** señalización, SFU, TURN, dispatch e Inference STT/TTS con
  Deepgram.
- **Tailscale + SSH:** canal privado PowerEdge–Aule para Ollama.

Los colegas acceden a la aplicación por el proxy HTTPS y a LiveKit por WebRTC;
no necesitan pertenecer a la tailnet. Ollama no se publica en Internet.
El worker abre conexiones salientes hacia LiveKit Cloud; PowerEdge no publica
puertos WebRTC. Tailscale Funnel continúa exponiendo solo la aplicación HTTPS y
no participa en ICE/TURN.

## Rutas

```text
Código y build:       /home/hii1sc/aimauta-build
PDFs:                 /home/hii1sc/aimauta-runtime/content
Índices:              /home/hii1sc/aimauta-runtime/indexes
Manifiestos:          /home/hii1sc/aimauta-runtime/manifests
Entorno del worker:   /home/hii1sc/aimauta-runtime/voice-agent.env
Entorno de LiveKit:   /home/hii1sc/aimauta-runtime/livekit-cloud.env
Entorno de pruebas:   /home/hii1sc/aimauta-runtime/voice-test-venv
```

Los directorios de runtime sobreviven a una actualización y no están dentro del
repositorio.

## Requisitos

- PowerEdge con Git, Node.js 22 o superior, npm y Docker Engine.
- Python 3.12 o 3.13 en PowerEdge para ejecutar las pruebas del worker.
- Tailscale y acceso SSH por llave desde PowerEdge hacia Aule.
- Ollama y `gemma4:e4b-it-qat` instalados en Aule.
- Un proyecto LiveKit Cloud y un par API dedicados a AImauta.
- Un proxy HTTPS administrado delante de Next.js.

No se reutilizan proyectos, API keys ni secretos de Nebu, SIHSALUS u otros
sistemas.

## Preparación inicial

En PowerEdge:

```bash
install -d -m 0750 \
  /home/hii1sc/aimauta-build \
  /home/hii1sc/aimauta-runtime/content \
  /home/hii1sc/aimauta-runtime/indexes \
  /home/hii1sc/aimauta-runtime/manifests

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

El proyecto LiveKit Cloud genera un par exclusivo para AImauta. Se copia
directamente a archivos `0600` fuera del repositorio y nunca se pega en una
conversación ni se incorpora a una imagen. LiveKit Inference reutiliza ese par;
no se crea ni se distribuye una clave independiente de Deepgram.

Los secretos no se imprimen en comandos de diagnóstico, no se registran en logs
y no se incorporan a Git.

## Alternativa: LiveKit Server self-hosted

El despliegue activo usa LiveKit Cloud. La configuración reproducible siguiente
se conserva como alternativa futura y no se inicia junto al proyecto Cloud.
El worker actual usa LiveKit Inference y **no es compatible** con las
credenciales de un servidor self-hosted. Reactivar esta alternativa exige
implementar y validar credenciales de inferencia separadas o un proveedor STT/TTS
directo; estos comandos por sí solos no habilitan la voz.

La configuración reproducible está en
[`infra/livekit`](../infra/livekit/README.md). Fija LiveKit Server y Caddy L4
por versión y digest AMD64, ejecuta ambos como el UID/GID no-root del operador,
monta la key pair como archivo de solo lectura y conserva certificados fuera de
Git.

Preparar sin iniciar ni publicar servicios:

```bash
cd /home/hii1sc/aimauta-build

infra/livekit/init-env.sh \
  /home/hii1sc/aimauta-runtime/livekit.env \
  livekit.ejemplo.edu \
  turn.ejemplo.edu \
  203.0.113.10

infra/livekit/render-config.sh \
  /home/hii1sc/aimauta-runtime/livekit.env

docker compose \
  --env-file /home/hii1sc/aimauta-runtime/livekit.env \
  -f infra/livekit/compose.yaml \
  config --quiet
```

Antes de `up -d`, los dos DNS deben resolver a la IPv4 declarada y los
firewalls del host y del proveedor deben permitir solo TCP 443/7881 y UDP
3478/7882. LiveKit fija 7880 a loopback y el firewall rechaza 5349 desde
interfaces externas: Next.js, el worker y Caddy consumen esos upstreams
localmente. Caddy comparte TCP 443 por SNI entre WSS y TURN/TLS. La guía
específica contiene el procedimiento de salud, prueba WebRTC, actualización y
rotación.

El fragmento nftables incluido bloquea únicamente los upstreams TCP 7880/5349
fuera de loopback, sin cambiar SSH ni los puertos públicos WebRTC. Debe quedar
integrado y verificado en el ruleset persistente antes de iniciar la pila.

## Entorno de Next.js

Guardar primero el par del proveedor en
`/home/hii1sc/aimauta-runtime/livekit-cloud.env`, modo `0600`:

```dotenv
LIVEKIT_URL=wss://proyecto-aimauta.livekit.cloud
LIVEKIT_API_URL=https://proyecto-aimauta.livekit.cloud
LIVEKIT_API_KEY=clave-cloud-de-aimauta
LIVEKIT_API_SECRET=secreto-cloud-de-aimauta
```

El archivo que Compose carga realmente es
`/home/hii1sc/aimauta-runtime/web.env`. Se crea una sola vez con
`infra/web/init-env.sh` y se le añaden las mismas cuatro variables `LIVEKIT_*`
sin sustituir sus secretos existentes:

```dotenv
AIMAUTA_CONTENT_DIR=/srv/aimauta/content
AIMAUTA_INDEX_DIR=/srv/aimauta/indexes
AIMAUTA_MANIFEST_DIR=/srv/aimauta/manifests
AIMAUTA_REMOTE_CONTENT_PROXY=false

AIMAUTA_SESSION_SECRET=valor-aleatorio-exclusivo-de-sesion
AIMAUTA_AGENT_SECRET=valor-aleatorio-exclusivo-del-worker
AIMAUTA_TRUST_PROXY_HEADERS=true

OLLAMA_BASE_URL=http://127.0.0.1:11435
OLLAMA_MODEL=gemma4:e4b-it-qat
OLLAMA_TIMEOUT_MS=45000

AIMAUTA_VOICE_TUTOR_ENABLED=false
LIVEKIT_URL=wss://proyecto-aimauta.livekit.cloud
LIVEKIT_API_URL=https://proyecto-aimauta.livekit.cloud
LIVEKIT_API_KEY=clave-cloud-de-aimauta
LIVEKIT_API_SECRET=secreto-cloud-de-aimauta
```

`LIVEKIT_API_URL` usa el mismo host del proyecto con esquema HTTPS para
RoomService y AgentDispatch. La URL WSS llega al navegador; la API key y el
secreto nunca lo hacen.

Aplicar permisos restringidos:

```bash
chmod 600 \
  /home/hii1sc/aimauta-runtime/livekit-cloud.env \
  /home/hii1sc/aimauta-runtime/web.env
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
LIVEKIT_API_KEY=clave-cloud-de-aimauta
LIVEKIT_API_SECRET=secreto-cloud-de-aimauta

AIMAUTA_APP_URL=http://127.0.0.1:3309
AIMAUTA_AGENT_SECRET=el-mismo-valor-configurado-en-nextjs

REQUEST_TIMEOUT_SECONDS=50
STT_MODEL=deepgram/nova-3
STT_LANGUAGE=es-419
TTS_MODEL=deepgram/aura-2
TTS_VOICE=selena
TTS_LANGUAGE=es-419
MAX_SESSION_SECONDS=600
```

`AIMAUTA_AGENT_SECRET` es el único **secreto propio de AImauta** compartido
entre ambos procesos. Next.js y el worker usan el mismo par dedicado de
LiveKit Cloud; ese par nunca llega al navegador. El worker no recibe
`OLLAMA_BASE_URL`, `OLLAMA_MODEL`,
`AIMAUTA_SESSION_SECRET` ni acceso a los índices.

Aplicar permisos:

```bash
chmod 600 /home/hii1sc/aimauta-runtime/voice-agent.env
```

El código inicia LiveKit Agents con `record=False`; no se habilita grabación,
Egress, Ingress, SIP ni Agent Observability. `WARN` reduce el logging operativo
y los mensajes propios del worker están redactados. LiveKit Inference declara
retención cero por defecto, pero esto no elimina el tratamiento: antes de
habilitar voz para menores deben existir consentimiento aplicable, revisión de
los acuerdos y una política verificada de retención y eliminación.

`MAX_SESSION_SECONDS=600` corta STT/TTS y el job aunque el navegador permanezca
conectado. El worker elimina la sala al cerrar; el navegador también aplica el
deadline devuelto por la API y se desconecta si el agente sale.

## Sincronización e indexación

Cada entrada del catálogo debe haber superado
[la política de contenidos](CONTENT_POLICY.md). En PowerEdge:

```bash
cd /home/hii1sc/aimauta-build

npm run catalog:validate

AIMAUTA_CONTENT_DIR=/home/hii1sc/aimauta-runtime/content \
  AIMAUTA_MANIFEST_DIR=/home/hii1sc/aimauta-runtime/manifests \
  npm run content:sync

AIMAUTA_CONTENT_DIR=/home/hii1sc/aimauta-runtime/content \
  AIMAUTA_INDEX_DIR=/home/hii1sc/aimauta-runtime/indexes \
  npm run content:index
```

Sin `--book`, ambos comandos procesan todos los materiales `published`. Para
repetir de forma selectiva uno de ellos puede añadirse, por ejemplo,
`-- --book fichas-matematica-2-secundaria`.

La validación del catálogo comprueba taxonomía, fuente, pin de integridad y
cobertura curricular sin huecos ni solapamientos. La sincronización verifica
dominio y ruta, tipo y firma PDF, tamaño y SHA-256; limita tiempo y bytes antes
de publicar el archivo. Después fusiona el resultado en
`content-manifest.generated.json`, un manifiesto runtime v2 acumulativo escrito
de forma atómica.

La indexación vuelve a comprobar checksum y total de páginas y genera el
contrato v2 con linaje del PDF, taxonomía, currículo, licencia y reporte de
calidad. La salida resume:

- páginas sin texto indexable;
- páginas con conteos de palabras atípicamente bajos o altos;
- fragmentos detectados como posibles respuestas o material docente.

El operador debe revisar ese reporte ante resultados inesperados. El runtime
rechaza índices con versión, estructura, checksum, taxonomía o currículo
incoherentes, sin licencia declarada o con estadísticas derivables de páginas
sin texto y material docente inconsistentes. Un fallo detiene el despliegue; no
se omiten estas comprobaciones ni se reutiliza un índice de otra edición.

## Pruebas y builds

### Aplicación

En PowerEdge:

```bash
cd /home/hii1sc/aimauta-build
npm run catalog:validate
npm run lint
npm run typecheck
npm test

AIMAUTA_CONTENT_DIR=/home/hii1sc/aimauta-runtime/content \
  AIMAUTA_INDEX_DIR=/home/hii1sc/aimauta-runtime/indexes \
  npm run build
```

Las pruebas cubren, entre otros contratos, la publicación fail-closed del
catálogo, ambos currículos, la firma, revisión, anti-replay, expiración y límite
de 40 turnos, los rate limits, el índice v2, la exclusión de `Evaluamos` y
material docente en RAG, los movimientos pedagógicos cerrados, el endpoint
interno y la indisponibilidad controlada de LiveKit.

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

### Perfil web público en PowerEdge

El perfil reproducible de `infra/web/compose.yaml` separa el proceso Next.js
del edge:

```text
Internet → Tailscale Funnel HTTPS en Aule
         → reverse SSH Aule 127.0.0.1:3308
         → Nginx PowerEdge 127.0.0.1:3308
         → Next.js PowerEdge 127.0.0.1:3309
         → Ollama Aule 127.0.0.1:11434
```

Nginx aplica límite de cuerpo, solicitudes y conexiones, bloquea externamente
`/api/internal/turn` y sanea los encabezados de identidad antes de entregarlos
a la aplicación. Next.js confía exclusivamente en el `X-Forwarded-For`
canónico escrito por Funnel. El túnel conserva ese encabezado sin exponer
ninguna escucha de PowerEdge. No se debe dirigir Funnel al puerto 3309.

Desde un checkout limpio:

```bash
infra/web/init-env.sh /home/hii1sc/aimauta-runtime/web.env
AIMAUTA_RELEASE="$(git rev-parse --short HEAD)" \
  docker compose -f infra/web/compose.yaml build
AIMAUTA_RELEASE="$(git rev-parse --short HEAD)" \
  docker compose -f infra/web/compose.yaml up -d

install -m 600 infra/web/aimauta-aule-ollama-tunnel.service \
  /home/hii1sc/.config/systemd/user/aimauta-aule-ollama-tunnel.service
install -m 600 infra/web/aimauta-aule-edge-tunnel.service \
  /home/hii1sc/.config/systemd/user/aimauta-aule-edge-tunnel.service
systemctl --user daemon-reload
systemctl --user enable --now aimauta-aule-ollama-tunnel.service
systemctl --user enable --now aimauta-aule-edge-tunnel.service
```

En Aule, con Tailscale `1.98.9` o posterior:

```bash
tailscale funnel --yes --bg --https=8443 http://127.0.0.1:3308
```

PowerEdge debe conservar `Linger=yes`. Funnel no se activa en versiones
afectadas por TS-2026-008.

La llave `aimauta_aule_edge_ed25519` es exclusiva de este reverse y no se
reutiliza para Ollama. En Aule su entrada de `authorized_keys` debe restringirse
a la IP Tailscale de PowerEdge y al listener exacto:

```text
from="100.120.80.60",restrict,port-forwarding,permitlisten="127.0.0.1:3308",permitopen="127.0.0.1:9",command="/bin/false" ssh-ed25519 <clave-pública> aimauta-poweredge-to-aule-edge
```

Antes de habilitar la unidad se verifica la huella fuera de banda y se prueba
que la llave no puede abrir shell ni un segundo puerto.

Este perfil habilita PDF y tutor de texto con Gemma. La voz queda disponible
después de configurar el proyecto LiveKit Cloud, desplegar el worker y cambiar
`AIMAUTA_VOICE_TUTOR_ENABLED` al valor exacto `true`. El entorno web debe
recibir las cuatro variables `LIVEKIT_*`, el worker apuntar a
`AIMAUTA_APP_URL=http://127.0.0.1:3309` y ambos deben compartir exactamente el
mismo `AIMAUTA_AGENT_SECRET`.

### Pila completa con voz

LiveKit Cloud no requiere un contenedor local ni puertos WebRTC entrantes.
Después de escribir los archivos protegidos, recrear la aplicación para que
Next.js adopte las variables:

```bash
cd /home/hii1sc/aimauta-build
AIMAUTA_RELEASE="$(git rev-parse --short HEAD)" \
  AIMAUTA_WEB_ENV_FILE=/home/hii1sc/aimauta-runtime/web.env \
  AIMAUTA_RUNTIME_DIR=/home/hii1sc/aimauta-runtime \
  docker compose -f infra/web/compose.yaml up -d --no-build --force-recreate
```

Si se migra desde una instalación self-hosted anterior, terminar primero las
salas activas, detener aquella pila con su propio Compose y retirar el
contenedor anterior `aimauta-voice-agent`. No se ejecutan simultáneamente ambos
transportes ni se reutilizan sus credenciales. En una instalación nueva este
paso no aplica.

Iniciar el worker en PowerEdge:

```bash
docker run -d \
  --name aimauta-voice-agent \
  --restart unless-stopped \
  --network host \
  --read-only \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  --pids-limit 512 \
  --stop-timeout 660 \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=256m,mode=1777 \
  --env-file /home/hii1sc/aimauta-runtime/voice-agent.env \
  aimauta-voice-agent:local
```

`--network host` permite que el contenedor alcance
`AIMAUTA_APP_URL=http://127.0.0.1:3309` sin publicar otro puerto. El proceso se
registra en LiveKit con el nombre exacto `aimauta-socratic-tutor`.
El filesystem de la imagen es de solo lectura; únicamente `/tmp` es efímero, y
el proceso no recibe capacidades Linux ni puede elevar privilegios.
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

El puerto 3309 permanece en loopback y se publica únicamente a través del edge
local 3308 y el proxy HTTPS. El edge bloquea el acceso externo a
`/api/internal/turn`; el worker lo consume por loopback y, además, la ruta exige
el bearer `AIMAUTA_AGENT_SECRET`.

La aplicación limita por sesión a 12 turnos de tutor y 6 accesos de voz por
minuto; la creación se limita a 12 sesiones nuevas por minuto y fingerprint del
cliente. Estos contadores viven en memoria y protegen una sola instancia; el
proxy o edge debe añadir su propio límite distribuido, tamaño máximo de body y
límite de conexiones. No debe reenviar al proceso cabeceras de identidad
aportadas directamente por el cliente.

## Validación posterior

Comprobaciones locales en PowerEdge:

```bash
curl --fail http://127.0.0.1:3309/
curl --fail --head \
  http://127.0.0.1:3309/api/materials/fichas-matematica-1-secundaria/pdf
curl --fail --head \
  http://127.0.0.1:3309/api/materials/fichas-matematica-2-secundaria/pdf
curl --fail http://127.0.0.1:11435/api/tags
curl --fail http://127.0.0.1:8081/
docker logs --tail 100 aimauta-voice-agent
```

Validar desde un navegador HTTPS:

1. comprobar que la biblioteca solo muestra materiales `published`, que la
   búsqueda funciona y que los filtros **Nivel → Grado → Curso** se actualizan
   en cascada;
2. abrir cada uno de los dos materiales y confirmar que PDF.js renderiza la
   página 13, que el texto es seleccionable y que funcionan zoom, ajuste al
   ancho, botones y teclado;
3. comprobar que el worker de PDF.js se carga desde la propia aplicación y que
   el `iframe` nativo aparece únicamente al simular un fallo definitivo o
   repetido de PDF.js;
4. escribir un intento y comprobar que el chat devuelve una sola pista o
   pregunta con cita de página;
5. activar la voz y comprobar que el micrófono permanece apagado hasta que se
   conecta el agente exacto; luego conceder permiso y confirmar un ciclo
   STT → tutor interno → TTS;
6. comprobar que un turno de voz actualiza turnos y nivel de apoyo en la
   interfaz, sin incrementar automáticamente el contador de intentos;
7. navegar a una página `Evaluamos`, por ejemplo la 21, y confirmar que chat,
   revisión y voz quedan bloqueados;
8. comprobar en LiveKit que la sala recibió el dispatch
   `aimauta-socratic-tutor`;
9. comprobar que la metadata de sala no contiene `session_token`, que el worker
   acepta solamente `student-<sessionId>` y que no existe grabación, Egress ni
   exportación de telemetría de la sesión.

La validación no debe imprimir tokens pedagógicos, transcripciones,
`AIMAUTA_AGENT_SECRET` ni credenciales de LiveKit.

## Actualización

En PowerEdge:

```bash
cd /home/hii1sc/aimauta-build
git fetch origin
git switch main
git pull --ff-only origin main
npm ci

npm run catalog:validate

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

/home/hii1sc/aimauta-runtime/voice-test-venv/bin/pytest \
  services/voice-agent/tests
docker build -t aimauta-voice-agent:local services/voice-agent

AIMAUTA_RELEASE="$(git rev-parse --short HEAD)" \
  AIMAUTA_WEB_ENV_FILE=/home/hii1sc/aimauta-runtime/web.env \
  AIMAUTA_RUNTIME_DIR=/home/hii1sc/aimauta-runtime \
  docker compose -f infra/web/compose.yaml build --pull
AIMAUTA_RELEASE="$(git rev-parse --short HEAD)" \
  AIMAUTA_WEB_ENV_FILE=/home/hii1sc/aimauta-runtime/web.env \
  AIMAUTA_RUNTIME_DIR=/home/hii1sc/aimauta-runtime \
  docker compose -f infra/web/compose.yaml up -d --no-build --force-recreate

docker stop --time 660 aimauta-voice-agent
docker rm aimauta-voice-agent
docker run -d \
  --name aimauta-voice-agent \
  --restart unless-stopped \
  --network host \
  --read-only \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  --pids-limit 512 \
  --stop-timeout 660 \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=256m,mode=1777 \
  --env-file /home/hii1sc/aimauta-runtime/voice-agent.env \
  aimauta-voice-agent:local
```

La sincronización puede omitirse cuando el catálogo no incorpora un material ni
una edición nueva; si se ejecuta, el pin evita una descarga distinta de la
aprobada y el manifiesto conserva los registros de los demás libros. La
indexación debe repetirse cuando cambian el PDF, el contrato del índice, el
extractor o la versión curricular. El perfil web se reconstruye y recrea
mediante Compose; después se reinicia el worker, si está habilitado, y se repite
la validación posterior.
Los comandos `docker stop`/`rm` aplican solo cuando el worker ya existe; en el
primer despliegue se omiten. Reiniciar un contenedor existente no adopta la
imagen recién construida: el administrador debe sustituirlo. El worker no
guarda estado durable dentro del contenedor.

## Operación segura

- Mantener activo y supervisado el túnel
  `127.0.0.1:11435 → Aule 127.0.0.1:11434`.
- No usar Funnel ni una escucha `0.0.0.0` para Ollama.
- Mantener `AIMAUTA_REMOTE_CONTENT_PROXY=false` cuando exista la copia local.
- Conservar PDFs, manifiestos e índices fuera de Git y regenerar los derivados
  únicamente desde la fuente oficial fijada.
- En despliegue público, sanear y reescribir las cabeceras de forwarding en el
  proxy y recién entonces usar `AIMAUTA_TRUST_PROXY_HEADERS=true`.
- Aplicar rate limits adicionales en el edge; los contadores de la aplicación
  son efímeros y single-instance.
- No registrar cuerpos de `/api/tutor` o `/api/internal/turn`.
- Mantener `record=False`, logs `WARN` redactados y el health del worker en
  `127.0.0.1`; no publicar el health aun cuando Docker use `--network host`.
- No respaldar conversaciones ni datos de menores.
- Mantener Agent Observability, Ingress, Egress, SIP y grabaciones
  deshabilitados; revisar consentimiento, acuerdos, retención y eliminación
  antes de habilitar voz para estudiantes.
- Rotar por separado los secretos de sesión, worker y LiveKit ante cualquier
  exposición.
- Regenerar los índices desde el PDF autorizado en vez de tratarlos como datos
  irremplazables.
