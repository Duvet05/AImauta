# Despliegue en PowerEdge

## Regla de ejecución

Las dependencias, la sincronización de PDFs, la generación de índices, las
pruebas y la compilación se ejecutan exclusivamente en PowerEdge. La Mac se usa
para edición y control de versiones; no es un host de build de AImauta.

## Topología del piloto

- **PowerEdge:** Next.js, contenido, índices/RAG y, posteriormente, el worker de
  LiveKit.
- **Aule:** Ollama con Gemma.
- **LiveKit Cloud:** señalización, SFU y TURN del piloto de voz.
- **Tailscale:** red privada PowerEdge–Aule.

Ollama no se publica en Internet. Debe escuchar únicamente en loopback con un
túnel privado persistente, o en la dirección Tailscale de Aule protegida por ACL
y firewall. Nunca se configura `OLLAMA_HOST=0.0.0.0` en este despliegue.

## Rutas

```text
Código y build: /home/hii1sc/aimauta-build
PDFs:           /home/hii1sc/aimauta-runtime/content
Índices:        /home/hii1sc/aimauta-runtime/indexes
```

Los directorios de runtime sobreviven a una actualización del código y no se
encuentran dentro del repositorio.

## Requisitos

- PowerEdge con acceso privado al repositorio.
- Node.js 22 o superior y npm.
- Tailscale conectado y una regla que permita únicamente PowerEdge → Aule en el
  puerto privado de Ollama.
- Ollama y el modelo Gemma disponibles en Aule.
- Espacio suficiente en
  `/home/hii1sc/aimauta-runtime/content`.

## Preparación inicial

Ejecutar en PowerEdge:

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

Si el directorio de código ya contiene el clon, no se vuelve a clonar. Se
actualiza con un avance `fast-forward` de la rama aprobada.

## Variables de entorno

Crear `/home/hii1sc/aimauta-build/.env.local` a partir de `.env.example`, sin
incorporarlo a Git:

```dotenv
AIMAUTA_CONTENT_DIR=/home/hii1sc/aimauta-runtime/content
AIMAUTA_INDEX_DIR=/home/hii1sc/aimauta-runtime/indexes
AIMAUTA_REMOTE_CONTENT_PROXY=false

OLLAMA_BASE_URL=http://<aule-tailscale-ip-o-tunel-local>:11434
OLLAMA_MODEL=gemma4:e4b-it-qat
OLLAMA_TIMEOUT_MS=45000
```

Aplicar permisos restringidos:

```bash
chmod 600 /home/hii1sc/aimauta-build/.env.local
```

En producción se recomienda
`AIMAUTA_REMOTE_CONTENT_PROXY=false`: el visor sirve el PDF sincronizado y
verificado, y no depende de una descarga remota durante la clase.

Las futuras variables `LIVEKIT_URL`, `LIVEKIT_API_KEY` y
`LIVEKIT_API_SECRET` se gestionan como secretos del servicio. No se escriben en
logs ni se envían al navegador.

## Sincronización autorizada

Cada entrada del catálogo debe haber superado
[la política de contenidos](CONTENT_POLICY.md). Luego, en PowerEdge:

```bash
cd /home/hii1sc/aimauta-build

AIMAUTA_CONTENT_DIR=/home/hii1sc/aimauta-runtime/content \
  npm run content:sync
```

El comando debe terminar mostrando el tamaño y el SHA-256 esperado. Un fallo de
dominio, firma, tamaño o checksum detiene el proceso; no se debe omitir esa
validación.

Para sincronizar únicamente el material inicial:

```bash
AIMAUTA_CONTENT_DIR=/home/hii1sc/aimauta-runtime/content \
  npm run content:sync -- --book fichas-matematica-1-secundaria
```

## Generación del índice

Ejecutar después de una sincronización válida:

```bash
cd /home/hii1sc/aimauta-build

AIMAUTA_CONTENT_DIR=/home/hii1sc/aimauta-runtime/content \
  AIMAUTA_INDEX_DIR=/home/hii1sc/aimauta-runtime/indexes \
  npm run content:index
```

El comando comprueba nuevamente el checksum y el número de páginas. El índice
generado queda fuera del repositorio.

## Validación y build

Ejecutar en PowerEdge:

```bash
cd /home/hii1sc/aimauta-build
npm run lint
npm run typecheck
npm test

AIMAUTA_CONTENT_DIR=/home/hii1sc/aimauta-runtime/content \
  AIMAUTA_INDEX_DIR=/home/hii1sc/aimauta-runtime/indexes \
  npm run build
```

No se despliega una revisión si falla cualquiera de estas comprobaciones.

## Inicio

Con `.env.local` instalado y el build listo:

```bash
cd /home/hii1sc/aimauta-build
npm run start -- --hostname 127.0.0.1 --port 3000
```

La aplicación debe publicarse mediante un proxy HTTPS administrado. El puerto
3000 no se expone directamente a Internet.

Comprobaciones locales mínimas:

```bash
curl --fail http://127.0.0.1:3000/
curl --fail --head \
  http://127.0.0.1:3000/api/materials/fichas-matematica-1-secundaria/pdf
```

Además se debe abrir el espacio de aprendizaje, cambiar de página y verificar
que una consulta al tutor devuelve una pista con su cita de página.

## Actualización

En PowerEdge:

```bash
cd /home/hii1sc/aimauta-build
git fetch origin
git switch main
git pull --ff-only origin main
npm ci

AIMAUTA_CONTENT_DIR=/home/hii1sc/aimauta-runtime/content \
  AIMAUTA_INDEX_DIR=/home/hii1sc/aimauta-runtime/indexes \
  npm run content:index

AIMAUTA_CONTENT_DIR=/home/hii1sc/aimauta-runtime/content \
  AIMAUTA_INDEX_DIR=/home/hii1sc/aimauta-runtime/indexes \
  npm run build
```

La sincronización se repite solo cuando el catálogo incorpora un material o una
edición aprobada. Después del build se reinicia el servicio con el mecanismo del
host y se realizan las comprobaciones mínimas.

## Operación segura

- Restringir el puerto de Ollama a la tailnet y a la identidad de PowerEdge.
- Mantener `AIMAUTA_REMOTE_CONTENT_PROXY=false` cuando exista la copia local
  verificada.
- No registrar cuerpos de `/api/tutor`.
- No respaldar conversaciones ni datos de menores.
- Regenerar índices desde el PDF autorizado en vez de tratarlos como datos
  irremplazables.
- Rotar las credenciales de LiveKit si aparecen en una salida, archivo o
  historial no autorizado.
