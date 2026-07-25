# Despliegue en PowerEdge

## Regla de ejecución

Las dependencias, la sincronización de PDFs, la generación de índices, las
pruebas, la compilación de Next.js y la construcción de las imágenes RAG y de
voz se ejecutan exclusivamente en PowerEdge. La Mac se usa para edición y
control de versiones; no se ejecutan allí `npm ci`, builds, pruebas,
instalaciones de Python ni `docker build`.

Todos los comandos de esta guía se ejecutan en PowerEdge, salvo que se indique
expresamente que corresponden a Aule o a una consola de proveedor.

## Topología

- **PowerEdge:** Next.js, PDFs, servicio RAG interno y worker de voz
  autohospedados.
- **Proveedores LLM temporales:** cadena explícita OpenAI, xAI y Gemini.
- **Aule opcional:** Ollama con Gemma, escuchando solamente en loopback.
- **LiveKit Cloud:** señalización, SFU, TURN, dispatch, Deepgram STT e
  Inworld TTS.
- **Tailscale + SSH:** canal privado PowerEdge–Aule para Ollama.

Los colegas acceden a la aplicación por el proxy HTTPS y a LiveKit por WebRTC;
no necesitan pertenecer a la tailnet. Ollama no se publica en Internet.
El worker abre conexiones salientes hacia LiveKit Cloud; PowerEdge no publica
puertos WebRTC. Tailscale Funnel continúa exponiendo solo la aplicación HTTPS y
no participa en ICE/TURN.

## Rutas

```text
Checkout de trabajo:  /home/hii1sc/aimauta-production
Releases inmutables:  /home/hii1sc/aimauta-releases/<commit>
PDFs:                 /home/hii1sc/aimauta-runtime/content
Índices:              /home/hii1sc/aimauta-runtime/indexes
Manifiestos:          /home/hii1sc/aimauta-runtime/manifests
Entorno del worker:   /home/hii1sc/aimauta-runtime/voice-agent.env
Entorno web:          /home/hii1sc/aimauta-runtime/web.env
Credenciales LLM:    /home/hii1sc/aimauta-runtime/model-providers.env
Entorno de LiveKit:   /home/hii1sc/aimauta-runtime/livekit-cloud.env
Entorno de pruebas:   /home/hii1sc/aimauta-runtime/voice-test-venv
```

El checkout se usa para editar, instalar dependencias y ejecutar todas las
validaciones. Cada despliegue se construye desde una copia limpia del commit
aprobado bajo `aimauta-releases`; los contenedores activos nunca deben apuntar
al checkout. Los directorios de runtime sobreviven a una actualización y no
están dentro del repositorio ni de un release.

## Requisitos

- PowerEdge con Git, Node.js 22 o superior, npm, Docker Engine y el plugin
  Compose v2.
- Python 3.12 o 3.13 en PowerEdge para ejecutar las pruebas del worker.
- Tailscale y acceso SSH por llave desde PowerEdge hacia Aule.
- Claves dedicadas de los proveedores cloud habilitados mientras se prepara
  Gemma 4.
- Opcionalmente, Ollama y `gemma4:e4b-it-qat` instalados en Aule para la
  ingesta privada y la migración posterior del tutor.
- Un proyecto LiveKit Cloud y un par API dedicados a AImauta.
- Un proxy HTTPS administrado delante de Next.js.

No se reutilizan proyectos, API keys ni secretos de Nebu, SIHSALUS u otros
sistemas.

Comprobar las herramientas Docker antes de abrir una ventana de despliegue:

```bash
docker compose version
docker buildx version
```

El 25 de julio de 2026 este PowerEdge todavía no tenía disponible Buildx. Los
builds se validaron con el constructor clásico, pero Docker ya muestra su aviso
de retirada. La instalación del plugin oficial queda como mantenimiento del
host compartido; no se improvisa durante una promoción ni se sustituye el
Docker Engine con producción activa.

## Preparación inicial

En PowerEdge:

```bash
install -d -m 0750 \
  /home/hii1sc/aimauta-production \
  /home/hii1sc/aimauta-releases \
  /home/hii1sc/aimauta-runtime/content \
  /home/hii1sc/aimauta-runtime/indexes \
  /home/hii1sc/aimauta-runtime/manifests

git clone git@github.com:Duvet05/AImauta.git \
  /home/hii1sc/aimauta-production

cd /home/hii1sc/aimauta-production
npm ci
```

Si el clon ya existe, se actualiza con un avance `fast-forward` de la rama
aprobada. No se reemplazan archivos de runtime al actualizar el código.

## Contrato de release

`/home/hii1sc/aimauta-production` puede contener trabajo en curso y artefactos
ignorados. No se construye ni se ejecuta producción desde allí. Después de
aprobar las pruebas, el operador crea un release exclusivamente con archivos
versionados:

```bash
set -euo pipefail
cd /home/hii1sc/aimauta-production

test -z "$(git status --porcelain)"
release_id="$(git rev-parse --short HEAD)"
release_root=/home/hii1sc/aimauta-releases
release_dir="${release_root}/${release_id}"
test ! -e "$release_dir"

staging_dir="$(mktemp -d "${release_root}/.${release_id}.XXXXXX")"
git archive --format=tar HEAD | tar -x -C "$staging_dir"
mv "$staging_dir" "$release_dir"
chmod -R a-w "$release_dir"
```

El nombre del directorio y las etiquetas de todas las imágenes AImauta deben
usar el mismo `release_id`. `git archive` impide copiar `.env`,
`infra/db/db.env`,
`node_modules`, cachés, archivos no versionados o cambios sin commit. No se
edita un release creado; una corrección exige otro commit y otro directorio.

Para identificar el release web activo sin inspeccionar secretos:

```bash
docker inspect aimauta-web-app-1 \
  --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}} {{.Config.Image}}'
docker inspect aimauta-voice-agent --format '{{.Config.Image}}'
```

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

El alias debe estar configurado en PowerEdge, autenticado por llave y
alcanzable dentro de Tailscale. El túnel se registra con el administrador de
servicios del host para que reinicie ante una caída; debe ejecutarse con el
usuario de servicio de AImauta y sin contraseña interactiva.

En el PowerEdge actual, ambos túneles son configuración administrada por el
host:

```text
/home/hii1sc/.config/systemd/user/aimauta-aule-ollama-tunnel.service
/home/hii1sc/.config/systemd/user/aimauta-aule-edge-tunnel.service
/home/hii1sc/.ssh/aimauta_aule_direct_config
```

Las unidades instaladas usan los alias `aimauta-aule-ollama-direct` y
`aimauta-aule-edge-direct`. Difieren deliberadamente de las plantillas
versionadas bajo `infra/web`, por lo que un redespliegue de la aplicación no las
copia ni las sobrescribe. Una modificación de túneles es mantenimiento de red
separado: se respalda la unidad activa, se valida el perfil SSH, se reinicia un
túnel por vez y se comprueba su endpoint antes de tocar el siguiente.

Las unidades ya están habilitadas y reinician los túneles ante fallas. Para que
arranquen después de un reinicio incluso antes del primer inicio de sesión de
`hii1sc`, un administrador debe habilitar una vez el *linger* del usuario:

```bash
sudo loginctl enable-linger hii1sc
```

Comprobar desde PowerEdge:

```bash
systemctl --user is-active \
  aimauta-aule-ollama-tunnel.service \
  aimauta-aule-edge-tunnel.service
curl --fail http://127.0.0.1:11435/api/tags
curl --fail http://127.0.0.1:3308/_edge-health
```

La ingesta privada y la futura migración del tutor pueden usar:

```dotenv
OLLAMA_BASE_URL=http://127.0.0.1:11435
```

El router actual de tutoría no selecciona Ollama aunque estas variables estén
presentes; OpenAI sigue siendo primario hasta completar la migración posterior.

No se usa Tailscale Funnel para Ollama, no se abre el puerto 11434 en el proxy
público y no se configura `OLLAMA_HOST=0.0.0.0`. El enlace queda:

```text
PowerEdge 127.0.0.1:11435
  └─ SSH sobre Tailscale
       └─ Aule 127.0.0.1:11434
```

## Secretos dedicados

Generar en PowerEdge cuatro valores aleatorios e independientes, cada uno de al
menos 32 caracteres:

```bash
openssl rand -base64 48
openssl rand -base64 48
openssl rand -base64 48
openssl rand -base64 48
```

- `AIMAUTA_SESSION_SECRET` firma el estado anónimo con HMAC.
- `AIMAUTA_AGENT_SECRET` autentica únicamente al worker ante
  `/api/internal/turn`.
- `AIMAUTA_ASSIGNMENT_ADMIN_SECRET` protege las rutas temporales de integración
  docente y nunca llega al navegador.
- `AIMAUTA_ASSIGNMENT_TOKEN_SECRET` cifra los tokens públicos y comprobantes
  que deben poder volver a descargarse.

El token v5 incluye una revisión monotónica, el contador de turnos y, cuando
corresponde, el alcance exacto de la tarea QR. Next.js
conserva en memoria la revisión vigente para rechazar replay y comprueba en el
token el límite de 40 turnos. El registro se pierde al reiniciar y no funciona
entre réplicas sin un almacén compartido; el despliegue documentado es de una
sola instancia. PostgreSQL conserva por separado las tareas QR, ejecuciones y
agregados anónimos.

Los cuatro secretos propios deben ser distintos. En especial,
`AIMAUTA_ASSIGNMENT_TOKEN_SECRET` no se rota como una variable ordinaria:
cambiarlo sin migrar los ciphertext existentes impide volver a recuperar
enlaces y comprobantes almacenados.

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
cd /home/hii1sc/aimauta-production

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

El entorno general que Compose carga es
`/home/hii1sc/aimauta-runtime/web.env`. Se crea una sola vez con
`infra/web/init-env.sh` y se le añaden las mismas cuatro variables `LIVEKIT_*`
sin sustituir sus secretos existentes:

```dotenv
AIMAUTA_PUBLIC_URL=https://host-publico-aimauta.example
DATABASE_URL=postgresql://aimauta:secreto@127.0.0.1:5432/aimauta?schema=public

AIMAUTA_CONTENT_DIR=/srv/aimauta/content
AIMAUTA_INDEX_DIR=/srv/aimauta/indexes
AIMAUTA_MANIFEST_DIR=/srv/aimauta/manifests
AIMAUTA_REMOTE_CONTENT_PROXY=false

AIMAUTA_SESSION_SECRET=valor-aleatorio-exclusivo-de-sesion
AIMAUTA_AGENT_SECRET=valor-aleatorio-exclusivo-del-worker
AIMAUTA_ADMIN_SECRET=valor-aleatorio-exclusivo-del-directorio
AIMAUTA_ASSIGNMENT_ADMIN_SECRET=valor-aleatorio-exclusivo-de-integracion
AIMAUTA_ASSIGNMENT_TOKEN_SECRET=valor-aleatorio-exclusivo-de-cifrado
AIMAUTA_TRUST_PROXY_HEADERS=true

AIMAUTA_LLM_TIMEOUT_MS=12000
AIMAUTA_LLM_MAX_CONCURRENCY=2
AIMAUTA_LLM_ATTEMPTS_PER_MINUTE=20
AIMAUTA_LLM_DAILY_REQUEST_LIMIT=300
AIMAUTA_LLM_DAILY_INPUT_TOKEN_LIMIT=150000
AIMAUTA_LLM_DAILY_OUTPUT_TOKEN_LIMIT=6000

OLLAMA_BASE_URL=http://127.0.0.1:11435
OLLAMA_MODEL=gemma4:e4b-it-qat
OLLAMA_TIMEOUT_MS=45000

AIMAUTA_AVATAR_ENABLED=false
AIMAUTA_VOICE_TUTOR_ENABLED=false
LIVEKIT_URL=wss://proyecto-aimauta.livekit.cloud
LIVEKIT_API_URL=https://proyecto-aimauta.livekit.cloud
LIVEKIT_API_KEY=clave-cloud-de-aimauta
LIVEKIT_API_SECRET=secreto-cloud-de-aimauta
```

Las credenciales del modelo viven en un segundo archivo que solo se inyecta al
contenedor de Next.js; el migrador y el build no las necesitan:

```dotenv
# /home/hii1sc/aimauta-runtime/model-providers.env
LLM_PROVIDER=openai
LLM_FALLBACK_PROVIDERS=xai,gemini
OPENAI_API_KEY=clave-de-un-proyecto-openai-dedicado
OPENAI_MODEL=gpt-4.1
XAI_API_KEY=clave-de-un-equipo-xai-dedicado
XAI_MODEL=grok-4.3
GOOGLE_GENAI_API_KEY=clave-de-un-proyecto-google-dedicado
GOOGLE_GENAI_MODEL=gemini-3.6-flash
```

No se admite seleccionar otro modelo mediante variables de entorno: la lista
permitida del tutor queda cerrada en código a OpenAI `gpt-4.1`, xAI
`grok-4.3` y Gemini `gemini-3.6-flash`; Ollama no se selecciona todavía. Cada
proveedor sólo se intenta si se nombra y tiene su credencial dedicada.

`LIVEKIT_API_URL` usa el mismo host del proyecto con esquema HTTPS para
RoomService y AgentDispatch. La URL WSS llega al navegador; la API key y el
secreto nunca lo hacen.

Aplicar permisos restringidos:

```bash
chmod 600 \
  /home/hii1sc/aimauta-runtime/model-providers.env \
  /home/hii1sc/aimauta-runtime/livekit-cloud.env \
  /home/hii1sc/aimauta-runtime/web.env
```

`AIMAUTA_REMOTE_CONTENT_PROXY=false` obliga al visor a usar el PDF local
sincronizado y verificado.

`AIMAUTA_PUBLIC_URL` es el origen HTTPS que verá el estudiante y no puede
incluir ruta, query, fragmento ni credenciales. `DATABASE_URL` apunta al
PostgreSQL administrado de AImauta; con `network_mode: host`, el contenedor
alcanza el listener de loopback del host.

Los límites diarios se comparten entre OpenAI, xAI y Gemini y se reservan en
PostgreSQL antes de cada llamada. Las variables permiten reducir los máximos
compilados de 300 intentos, 150 000 tokens de entrada y 6 000 tokens de salida
por día, nunca aumentarlos. Cada fallback cuenta como un segundo intento; no hay
reintentos automáticos. Si el registro de presupuesto falla, el tutor usa la
respuesta determinista y no llama a ningún proveedor.

Las peticiones de nube usan `store: false`, pero este parámetro no equivale a
retención cero. OpenAI documenta que sus datos de API no se usan para entrenar
por defecto y que el monitoreo de abuso puede conservar contenido hasta 30
días; xAI documenta el mismo plazo predeterminado para auditoría. Google
distingue los logs configurables de la retención necesaria para monitoreo de
abuso. Para un piloto con menores, verificar y contratar Zero Data Retention o
el control equivalente en cada proyecto antes de habilitar estas claves.
Véanse los controles de datos de
[OpenAI](https://developers.openai.com/api/docs/guides/your-data), la
[guía de seguridad de xAI](https://docs.x.ai/developers/faq/security) y la
[política de logs de Gemini](https://ai.google.dev/gemini-api/docs/logs-policy).

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
TTS_MODEL=inworld/inworld-tts-2
TTS_VOICE=Diego
TTS_LANGUAGE=es
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
cd /home/hii1sc/aimauta-production

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
cd /home/hii1sc/aimauta-production
npm run catalog:validate
npm run lint
npm run typecheck
npm test
npm run audit:production

AIMAUTA_CONTENT_DIR=/home/hii1sc/aimauta-runtime/content \
  AIMAUTA_INDEX_DIR=/home/hii1sc/aimauta-runtime/indexes \
  npm run build
```

Las pruebas cubren, entre otros contratos, la publicación fail-closed del
catálogo, ambos currículos, la firma, revisión, anti-replay, expiración y límite
de 40 turnos, los rate limits, el índice v2, la exclusión de `Evaluamos` y
material docente en RAG, los movimientos pedagógicos cerrados, el endpoint
interno y la indisponibilidad controlada de LiveKit.

### Servicio RAG interno

La imagen ejecuta sus pruebas unitarias durante el target `test` y luego se
construye sin herramientas de instalación:

```bash
cd /home/hii1sc/aimauta-production
docker build --target test \
  -t aimauta-rag-test:local services/rag-service
docker build -t aimauta-rag:local services/rag-service
```

El servicio no usa un archivo de entorno ni recibe claves LLM. Compose lo fija
a `127.0.0.1:3310`, monta únicamente
`/home/hii1sc/aimauta-runtime/indexes` en read-only y limita memoria, CPU,
procesos y concurrencia. `AIMAUTA_RUNTIME_GID` debe coincidir con el grupo que
posee los índices (por defecto `1000` en este PowerEdge), de modo que continúen
en `0640` y los directorios en `0750`. El cliente Next.js rechaza cualquier URL
distinta de ese loopback exacto y Compose no inicia la aplicación hasta que el
health de RAG esté sano.

`npm run audit:production` debe terminar sin alertas. Las alertas exclusivas de
herramientas de desarrollo se revisan por separado; no se ejecuta
`npm audit fix --force`, porque puede degradar dependencias mayores o romper la
compatibilidad de Next.js. Los overrides transitivos de Prisma fijados en
`package.json` son parches de seguridad deliberados y se conservan solo mientras
pasen generación del cliente, migraciones, pruebas y build.

El `postbuild` elimina `.env` y `.env.production` del standalone —Next.js los
copia cuando existen en el checkout— y recorre el artefacto para rechazar
secretos o directorios ajenos al runtime. Una promoción usa además un release
creado con `git archive`, donde esos archivos nunca existen.

### Worker de voz

Crear una vez el entorno de pruebas en PowerEdge:

```bash
python3 -m venv /home/hii1sc/aimauta-runtime/voice-test-venv
/home/hii1sc/aimauta-runtime/voice-test-venv/bin/pip install \
  --require-hashes \
  -r /home/hii1sc/aimauta-production/services/voice-agent/requirements.lock
/home/hii1sc/aimauta-runtime/voice-test-venv/bin/pip install \
  --no-deps \
  -e /home/hii1sc/aimauta-production/services/voice-agent
/home/hii1sc/aimauta-runtime/voice-test-venv/bin/pip install \
  --no-deps \
  --require-hashes \
  -r /home/hii1sc/aimauta-production/services/voice-agent/requirements-test.lock
```

Ejecutar sus pruebas:

```bash
cd /home/hii1sc/aimauta-production
/home/hii1sc/aimauta-runtime/voice-test-venv/bin/pytest \
  services/voice-agent/tests
```

`requirements-test.lock` fija también con hashes las herramientas de arranque y
prueba, incluido `pip`, `pytest` y `pytest-asyncio`; se instala sin resolver
dependencias implícitas sobre el lock de runtime. La imagen de producción
instala solamente `requirements.lock`, elimina `pip` del entorno copiado,
excluye pruebas y ejecuta el worker como un usuario sin privilegios. No se
despliega una revisión si falla una comprobación. La imagen de producción se
construye después desde el release limpio y recibe la misma etiqueta de commit
que la imagen web.

## Migraciones de PostgreSQL

La imagen `aimauta-migrate:<commit>` contiene Prisma y únicamente los archivos
necesarios para ejecutar `prisma migrate deploy`. Compose la ejecuta como un
servicio one-shot, sin privilegios y con filesystem de solo lectura. La
aplicación depende de que ese servicio termine correctamente; si una migración
falla, Next.js no se inicia con el esquema incompleto.

Antes de promover un release que incluya migraciones:

1. confirmar un backup recuperable de PostgreSQL;
2. revisar el SQL versionado bajo `prisma/migrations`;
3. construir las imágenes `aimauta-migrate` y `aimauta-web` del mismo commit;
4. ejecutar `docker compose up` y comprobar que `migrate` terminó con código 0;
5. validar `npx prisma migrate status` desde el checkout con el mismo
   `DATABASE_URL`, sin imprimir la cadena.

En desarrollo o staging puede comprobarse el ciclo QR completo después de
aplicar la migración:

```bash
npm run assignments:smoke
```

Ese smoke crea una tarea y una ejecución efímeras, verifica el comprobante y
elimina el fixture. No se usa como sustituto de las pruebas ni se ejecuta por
primera vez sobre producción.

Una reversión de imagen no revierte automáticamente el esquema. La migración
inicial de tareas QR es aditiva y el release anterior ignora sus tablas; futuras
migraciones deben declarar explícitamente su compatibilidad y procedimiento de
rollback antes de promocionarse.

## Inicio de servicios

### Perfil web público en PowerEdge

El perfil reproducible de `infra/web/compose.yaml` separa el proceso Next.js
del edge:

```text
Internet → Tailscale Funnel HTTPS en Aule
         → reverse SSH Aule 127.0.0.1:3308
         → Nginx PowerEdge 127.0.0.1:3308
         → Next.js PowerEdge 127.0.0.1:3309
         → RAG interno PowerEdge 127.0.0.1:3310
         → OpenAI → xAI → Gemini
         → Ollama Aule 127.0.0.1:11434 (opcional)
```

Nginx aplica límite de cuerpo, solicitudes y conexiones, bloquea externamente
`/api/internal/turn` y sanea los encabezados de identidad antes de entregarlos
a la aplicación. Next.js confía exclusivamente en el `X-Forwarded-For`
canónico escrito por Funnel. El túnel conserva ese encabezado sin exponer
ninguna escucha de PowerEdge. No se debe dirigir Funnel al puerto 3309.

Desde el release limpio creado previamente:

```bash
release_id="$(git -C /home/hii1sc/aimauta-production rev-parse --short HEAD)"
release_dir="/home/hii1sc/aimauta-releases/${release_id}"
test -d "$release_dir"

# Solo en la preparación inicial; nunca sustituye un archivo con secretos.
if [ ! -e /home/hii1sc/aimauta-runtime/web.env ]; then
  "$release_dir/infra/web/init-env.sh" \
    /home/hii1sc/aimauta-runtime/web.env
fi

AIMAUTA_RELEASE="$release_id" \
  AIMAUTA_WEB_ENV_FILE=/home/hii1sc/aimauta-runtime/web.env \
  AIMAUTA_MODEL_ENV_FILE=/home/hii1sc/aimauta-runtime/model-providers.env \
  AIMAUTA_RUNTIME_DIR=/home/hii1sc/aimauta-runtime \
  docker compose -f "$release_dir/infra/web/compose.yaml" build --pull
AIMAUTA_RELEASE="$release_id" \
  AIMAUTA_WEB_ENV_FILE=/home/hii1sc/aimauta-runtime/web.env \
  AIMAUTA_MODEL_ENV_FILE=/home/hii1sc/aimauta-runtime/model-providers.env \
  AIMAUTA_RUNTIME_DIR=/home/hii1sc/aimauta-runtime \
  docker compose -f "$release_dir/infra/web/compose.yaml" \
  up -d --no-build --force-recreate

AIMAUTA_RELEASE="$release_id" \
  AIMAUTA_WEB_ENV_FILE=/home/hii1sc/aimauta-runtime/web.env \
  AIMAUTA_MODEL_ENV_FILE=/home/hii1sc/aimauta-runtime/model-providers.env \
  AIMAUTA_RUNTIME_DIR=/home/hii1sc/aimauta-runtime \
  docker compose -f "$release_dir/infra/web/compose.yaml" \
  ps --all migrate rag app edge

# Los túneles son configuración administrada por el host.
systemctl --user is-active \
  aimauta-aule-ollama-tunnel.service \
  aimauta-aule-edge-tunnel.service
```

En Aule, con Tailscale `1.98.9` o posterior:

```bash
tailscale version
tailscale funnel --yes --bg --https=8443 http://127.0.0.1:3308
```

La versión se comprueba en **Aule**; la versión de PowerEdge no demuestra la
versión del nodo que ejecuta Funnel. PowerEdge debe conservar `Linger=yes`.
Funnel no se activa en versiones afectadas por
[TS-2026-008](https://tailscale.com/security-bulletins#ts-2026-008).

La auditoría del 25 de julio de 2026 encontró Tailscale `1.98.4` en PowerEdge,
con Tailscale SSH, Serve, Funnel y Services deshabilitados. No se habilita
ninguna de esas funciones allí antes de actualizar a `1.98.9` o posterior. La
actualización del daemon es mantenimiento del host compartido y queda fuera de
una promoción normal de AImauta.

La llave `aimauta_aule_edge_ed25519` es exclusiva de este reverse y no se
reutiliza para Ollama. En Aule su entrada de `authorized_keys` debe restringirse
a la IP Tailscale de PowerEdge y al listener exacto:

```text
from="<IP-Tailscale-actual-de-PowerEdge>",restrict,port-forwarding,permitlisten="127.0.0.1:3308",permitopen="127.0.0.1:9",command="/bin/false" ssh-ed25519 <clave-pública> aimauta-poweredge-to-aule-edge
```

La IP autorizada se obtiene con `tailscale ip -4`; no se copia un valor antiguo
de esta guía. Antes de habilitar la unidad se verifica la huella fuera de banda
y se prueba que la llave no puede abrir shell ni un segundo puerto.

Este perfil habilita PDF y tutor de texto con el router LLM configurado. La
vista previa local se
habilita con `AIMAUTA_AVATAR_ENABLED=true` y sigue oculta salvo en una URL de
aprendizaje con `?avatar=1`.

La voz queda disponible después de configurar el proyecto LiveKit Cloud,
desplegar el worker y cambiar `AIMAUTA_VOICE_TUTOR_ENABLED` al valor exacto
`true`. El entorno web debe
recibir las cuatro variables `LIVEKIT_*`, el worker apuntar a
`AIMAUTA_APP_URL=http://127.0.0.1:3309` y ambos deben compartir exactamente el
mismo `AIMAUTA_AGENT_SECRET`.

### Pila completa con voz

LiveKit Cloud no requiere un contenedor local ni puertos WebRTC entrantes.
Después de escribir los archivos protegidos, recrear la aplicación para que
Next.js adopte las variables:

```bash
release_id="$(git -C /home/hii1sc/aimauta-production rev-parse --short HEAD)"
release_dir="/home/hii1sc/aimauta-releases/${release_id}"
test -d "$release_dir"

AIMAUTA_RELEASE="$release_id" \
  AIMAUTA_WEB_ENV_FILE=/home/hii1sc/aimauta-runtime/web.env \
  AIMAUTA_MODEL_ENV_FILE=/home/hii1sc/aimauta-runtime/model-providers.env \
  AIMAUTA_RUNTIME_DIR=/home/hii1sc/aimauta-runtime \
  docker compose -f "$release_dir/infra/web/compose.yaml" \
  up -d --no-build --force-recreate
```

Si se migra desde una instalación self-hosted anterior, terminar primero las
salas activas, detener aquella pila con su propio Compose y retirar el
contenedor anterior `aimauta-voice-agent`. No se ejecutan simultáneamente ambos
transportes ni se reutilizan sus credenciales. En una instalación nueva este
paso no aplica.

Iniciar el worker en PowerEdge:

```bash
docker build \
  -t "aimauta-voice-agent:${release_id}" \
  "$release_dir/services/voice-agent"

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
  "aimauta-voice-agent:${release_id}"
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
curl --fail http://127.0.0.1:3310/health
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
10. en staging, crear una tarea con la integración protegida, descargar su QR,
    escanearlo en otro navegador, completar el criterio y verificar que el
    comprobante no expone identidad ni texto del intento.

La validación no debe imprimir tokens pedagógicos, transcripciones,
`AIMAUTA_AGENT_SECRET` ni credenciales de LiveKit.

## Actualización

La actualización parte de un commit aprobado y termina con imágenes etiquetadas
con ese mismo commit. Nunca se despliegan cambios locales sin confirmar.

### 1. Actualizar y validar el checkout

```bash
set -euo pipefail
cd /home/hii1sc/aimauta-production
test -z "$(git status --porcelain)"

git fetch origin
git switch main
git pull --ff-only origin main
npm ci

npm run catalog:validate

/home/hii1sc/aimauta-runtime/voice-test-venv/bin/pip install \
  --require-hashes \
  -r /home/hii1sc/aimauta-production/services/voice-agent/requirements.lock
/home/hii1sc/aimauta-runtime/voice-test-venv/bin/pip install \
  --no-deps \
  --require-hashes \
  -r /home/hii1sc/aimauta-production/services/voice-agent/requirements-test.lock
/home/hii1sc/aimauta-runtime/voice-test-venv/bin/pip install \
  --no-deps \
  -e /home/hii1sc/aimauta-production/services/voice-agent

# Ejecutar estas dos operaciones solo si cambió el material o su contrato.
AIMAUTA_CONTENT_DIR=/home/hii1sc/aimauta-runtime/content \
  AIMAUTA_MANIFEST_DIR=/home/hii1sc/aimauta-runtime/manifests \
  npm run content:sync

AIMAUTA_CONTENT_DIR=/home/hii1sc/aimauta-runtime/content \
  AIMAUTA_INDEX_DIR=/home/hii1sc/aimauta-runtime/indexes \
  npm run content:index

npm run lint
npm run typecheck
npm test
npm run audit:production

AIMAUTA_CONTENT_DIR=/home/hii1sc/aimauta-runtime/content \
  AIMAUTA_INDEX_DIR=/home/hii1sc/aimauta-runtime/indexes \
  npm run build

/home/hii1sc/aimauta-runtime/voice-test-venv/bin/pytest \
  services/voice-agent/tests
```

La sincronización puede omitirse cuando el catálogo no incorpora un material ni
una edición nueva. La indexación debe repetirse cuando cambian el PDF, el
contrato del índice, el extractor o la versión curricular. Un cambio de
contrato runtime necesita su propio plan de rollback; no se presupone que una
imagen anterior consumirá artefactos nuevos.

### 2. Crear y construir el release

Crear el directorio mediante el procedimiento de
[Contrato de release](#contrato-de-release). Luego:

```bash
release_id="$(git -C /home/hii1sc/aimauta-production rev-parse --short HEAD)"
release_dir="/home/hii1sc/aimauta-releases/${release_id}"
test -d "$release_dir"

AIMAUTA_RELEASE="$release_id" \
  AIMAUTA_WEB_ENV_FILE=/home/hii1sc/aimauta-runtime/web.env \
  AIMAUTA_MODEL_ENV_FILE=/home/hii1sc/aimauta-runtime/model-providers.env \
  AIMAUTA_RUNTIME_DIR=/home/hii1sc/aimauta-runtime \
  docker compose -f "$release_dir/infra/web/compose.yaml" config --quiet

AIMAUTA_RELEASE="$release_id" \
  AIMAUTA_WEB_ENV_FILE=/home/hii1sc/aimauta-runtime/web.env \
  AIMAUTA_MODEL_ENV_FILE=/home/hii1sc/aimauta-runtime/model-providers.env \
  AIMAUTA_RUNTIME_DIR=/home/hii1sc/aimauta-runtime \
  docker compose -f "$release_dir/infra/web/compose.yaml" build --pull

docker build \
  -t "aimauta-voice-agent:${release_id}" \
  "$release_dir/services/voice-agent"

docker image inspect \
  "aimauta-migrate:${release_id}" \
  "aimauta-web:${release_id}" \
  "aimauta-rag:${release_id}" \
  "aimauta-voice-agent:${release_id}" >/dev/null
```

Todos los builds terminan antes de sustituir un contenedor. Si alguno falla, el
release activo permanece intacto.

### 3. Promover

La recreación de Next.js descarta las sesiones pedagógicas guardadas en memoria.
La sustitución del worker termina sesiones de voz activas; se realiza en una
ventana sin participantes. Compose ejecuta primero el migrador del mismo
`release_id` y no inicia la aplicación si aquel falla.

```bash
AIMAUTA_RELEASE="$release_id" \
  AIMAUTA_WEB_ENV_FILE=/home/hii1sc/aimauta-runtime/web.env \
  AIMAUTA_MODEL_ENV_FILE=/home/hii1sc/aimauta-runtime/model-providers.env \
  AIMAUTA_RUNTIME_DIR=/home/hii1sc/aimauta-runtime \
  docker compose -f "$release_dir/infra/web/compose.yaml" \
  up -d --no-build --force-recreate

if docker container inspect aimauta-voice-agent >/dev/null 2>&1; then
  docker stop --time 660 aimauta-voice-agent
  docker rm aimauta-voice-agent
fi
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
  "aimauta-voice-agent:${release_id}"
```

Si la voz está deshabilitada, se construye la imagen para comprobarla pero se
omite el bloque de sustitución del worker. Reiniciar un contenedor existente no
adopta una imagen nueva: siempre debe recrearse. El worker no guarda estado
durable dentro del contenedor.

### 4. Validar y conservar rollback

Ejecutar toda la sección [Validación posterior](#validación-posterior) y
confirmar además:

```bash
docker compose -f "$release_dir/infra/web/compose.yaml" ps --all
docker inspect aimauta-web-app-1 \
  --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}} {{.Config.Image}}'
docker inspect aimauta-web-rag-1 --format '{{.Config.Image}}'
docker inspect aimauta-voice-agent --format '{{.Config.Image}}'
systemctl --user is-active \
  aimauta-aule-ollama-tunnel.service \
  aimauta-aule-edge-tunnel.service
```

Se conservan como mínimo el release y las imágenes activos más el último
release conocido como bueno. Para volver a una versión anterior cuyo runtime
siga siendo compatible:

```bash
previous_id=abcdef0
previous_dir="/home/hii1sc/aimauta-releases/${previous_id}"
test -d "$previous_dir"
docker image inspect \
  "aimauta-web:${previous_id}" \
  "aimauta-rag:${previous_id}" >/dev/null

AIMAUTA_RELEASE="$previous_id" \
  AIMAUTA_WEB_ENV_FILE=/home/hii1sc/aimauta-runtime/web.env \
  AIMAUTA_MODEL_ENV_FILE=/home/hii1sc/aimauta-runtime/model-providers.env \
  AIMAUTA_RUNTIME_DIR=/home/hii1sc/aimauta-runtime \
  docker compose -f "$previous_dir/infra/web/compose.yaml" \
  up -d --no-build --force-recreate
```

Si también se revierte voz, se sustituye el worker con
`aimauta-voice-agent:${previous_id}` usando las mismas restricciones del bloque
de promoción. Si el release cambió índices, manifiestos o PDF, se restauran
primero los artefactos runtime compatibles mediante su procedimiento específico.

## Limpieza segura en el host compartido

Antes de limpiar, inventariar:

```bash
cd /home/hii1sc/aimauta-production
git status --short
git clean -nd
git clean -ndX
docker system df
docker ps -a
```

- No ejecutar `git clean -fdX`: `.env` e `infra/db/db.env` son secretos
  ignorados y también serían eliminados.
- No ejecutar `docker system prune -a`, `docker container prune` ni
  `docker volume prune`: PowerEdge aloja otros productos y sus contenedores,
  imágenes y volúmenes están fuera del alcance de AImauta.
- No borrar `/home/hii1sc/aimauta-runtime`,
  `/home/hii1sc/aimauta-ingest` ni el release activo. Los PDFs, índices,
  manifiestos, soluciones, entornos y secretos viven fuera de Git.
- Los worktrees bajo `/home/hii1sc/.aimauta-worktrees` son carriles de trabajo;
  se eliminan solo cuando su rama haya sido integrada y esté limpia.
- Las cachés `__pycache__`, `.pytest_cache`, `.next`, `*.tsbuildinfo`,
  `next-env.d.ts` y `lib/generated/prisma` son regenerables, pero se eliminan
  únicamente por rutas explícitas. Nunca se usa un glob desde `/home`.
- Una imagen o un release viejo se elimina por nombre exacto y solo después de
  verificar que no lo referencia un contenedor y que queda al menos un rollback
  bueno.
- PostgreSQL de `infra/db` es un servicio local separado y no forma parte de la
  promoción web. Su volumen nunca se elimina durante una actualización.

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
