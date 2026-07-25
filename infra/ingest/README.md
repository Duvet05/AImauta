# Ingesta privada de libros

La ingesta de libros no forma parte de la aplicación pública. En esta etapa no
existe, ni debe añadirse, un endpoint HTTP de administración, subida o
procesamiento. El límite de autenticación es el acceso SSH individual al
usuario operador de PowerEdge.

## Separación de datos

El contrato de directorios es:

```text
/home/hii1sc/aimauta-ingest/              0700
├── inbox/                                0700  PDF y metadata recién subidos
├── jobs/                                 0700  trabajo, estados y revisión
└── secrets/                              0700  credenciales del worker

/home/hii1sc/aimauta-runtime/             0750
├── content/                              0750  PDF publicados
├── indexes/                              0750  índices RAG publicados
├── manifests/
│   └── exercises/                        0750  <bookId>.public.json
├── exercise-solutions/                   0750  .private.json + .release.json
└── releases/                             0750  releases inmutables/rollback
```

Los archivos de trabajo y secretos deben crearse con `0600`. Los artefactos
publicados pueden usar `0640`. El contenedor web monta los directorios runtime
en modo de solo lectura; nunca monta `aimauta-ingest`.

Inicializar o reparar idempotentemente los modos:

```bash
cd /home/hii1sc/aimauta-production
chmod +x infra/ingest/init-runtime.sh
infra/ingest/init-runtime.sh
```

El script rechaza ejecución como root, rutas que sean enlaces simbólicos,
directorios o artefactos con otro dueño y rutas existentes del tipo
incorrecto. Además normaliza a `0640` los PDF e índices existentes; no crea ni
muestra credenciales.

En instalaciones existentes, conserve los secretos actuales de
`/home/hii1sc/aimauta-runtime/web.env`, añada únicamente estas rutas y mantenga
el archivo en modo `0600`:

```dotenv
AIMAUTA_EXERCISE_MANIFEST_DIR=/srv/aimauta/manifests/exercises
AIMAUTA_EXERCISE_SOLUTION_DIR=/srv/aimauta/exercise-solutions
```

## Subida por SSH

Use un identificador hexadecimal nuevo por trabajo y termine primero en
`.part`. El nombre original del archivo no se reutiliza como ruta del servidor:

```bash
job_id="$(openssl rand -hex 16)"

scp -- libro.pdf \
  "poweredge:/home/hii1sc/aimauta-ingest/inbox/${job_id}.pdf.part"
scp -- metadata.json \
  "poweredge:/home/hii1sc/aimauta-ingest/inbox/${job_id}.json.part"
```

El comando de admisión del worker debe abrir esos archivos sin seguir enlaces,
validar firma PDF, tamaño, checksum, páginas y metadata obligatoria, y moverlos
a `jobs/<job_id>/` mediante `rename` atómico. Sólo después elimina el sufijo
`.part`. No debe descargar una URL aportada por el manifiesto ni usar el nombre
original del PDF como nombre de destino.

## Credencial del modelo

La clave del proveedor se guarda exclusivamente en:

```text
/home/hii1sc/aimauta-ingest/secrets/model-api-key
```

Para transferirla sin colocarla en argumentos ni historial:

```bash
read -r -s model_api_key
printf '%s' "$model_api_key" |
  ssh poweredge \
    'set -eu
     umask 077
     key_part=/home/hii1sc/aimauta-ingest/secrets/model-api-key.part
     key_file=/home/hii1sc/aimauta-ingest/secrets/model-api-key
     dd of="$key_part" status=none
     chmod 600 "$key_part"
     mv -f "$key_part" "$key_file"'
unset model_api_key
```

El job recibe ese archivo como credencial de solo lectura, por ejemplo en
`/run/secrets/model-api-key`. La clave no se copia a `web.env`, no se declara
como `NEXT_PUBLIC_*`, no se incorpora a una imagen y no se escribe en logs,
estados, respuestas del modelo ni manifiestos.

## Procesamiento del libro

Antes de procesar un libro nuevo, su metadata completa debe existir en
`config/catalog.v3.json` y su cobertura curricular, sin huecos ni
solapamientos, en `config/curricula.v3.json`. `npm run catalog:validate` debe
aprobar. Un PDF no catalogado nunca recibe un currículo inferido ni habilita
RAG.

Desde el checkout privado de PowerEdge, cree un directorio nuevo por job y
ejecute el coordinador. La clave se entrega como ruta de archivo, nunca como
valor en la línea de comandos:

```bash
job_id="$(openssl rand -hex 16)"
job_dir="/home/hii1sc/aimauta-ingest/jobs/$job_id"
install -d -m 0700 "$job_dir"

npm run exercises:ingest -- \
  --book fichas-matematica-1-secundaria \
  --pdf /home/hii1sc/aimauta-runtime/content/fichas-matematica-1-secundaria.pdf \
  --output "$job_dir" \
  --provider google \
  --model gemma-4-26b-a4b-it
```

Para mantener las páginas en infraestructura propia, el mismo contrato puede
usar Gemma 4 en el Ollama privado de Aule a través del túnel loopback de
PowerEdge. Este es el proveedor predeterminado cuando no se define
`--provider`; no lee ni requiere el archivo de clave:

```bash
AIMAUTA_OLLAMA_INGEST_URL=http://127.0.0.1:11435 \
npm run exercises:ingest -- \
  --book fichas-matematica-1-secundaria \
  --pdf /home/hii1sc/aimauta-runtime/content/fichas-matematica-1-secundaria.pdf \
  --output "$job_dir" \
  --provider ollama \
  --model gemma4:e4b-it-qat
```

El adaptador Ollama sólo admite destinos loopback, bloquea redirecciones y
exige exactamente una llamada a la herramienta estructurada esperada. Una
respuesta libre, una herramienta distinta o argumentos inválidos fallan
cerrado.

`AIMAUTA_INGEST_ROOT` usa
`/home/hii1sc/aimauta-ingest` de forma predeterminada. El comando rechaza root,
raíces o archivos con otro dueño, enlaces simbólicos, claves fuera de
`<ingestRoot>/secrets` y destinos que no sean hijos directos de
`<ingestRoot>/jobs`. La clave predeterminada es
`<ingestRoot>/secrets/model-api-key`; `--api-key-file` sólo permite escoger
otro archivo directo dentro de ese mismo directorio.

El comando valida el PDF contra bytes, páginas y SHA-256 del catálogo,
renderiza JPEG de hasta 1600 px y envía a la API ventanas solapadas de hasta
tres páginas. Produce únicamente:

- `<bookId>.public.draft.json`;
- `<bookId>.private.draft.json`;
- `<bookId>.ingestion-report.json`.

El reporte usa `schemaVersion: 3`, registra proveedor, alcance del endpoint y
versión del contrato, y conserva una entrada única por página con
su estado (`no_exercise`, `exercise_found` o `uncertain`) y cantidad de
candidatos. La ingesta rechaza contradicciones entre estado y candidatos. Una
página incierta, estados discrepantes entre ventanas, huecos o duplicados son
bloqueantes: el par revisado no podrá promoverse hasta repetir o corregir la
ingesta y producir un reporte sin `coverage.blockers`.

Cada incidencia de candidato (`issues[]`) también nace sin resolver y bloquea
la promoción. La revisión debe conservarla y añadir `resolution`
(`accepted-after-review` o `rejected-after-review`), `resolutionNote` y
`reviewedAt`; borrarla no es necesario ni recomendable. Un conflicto de ID
estable nunca se descarta silenciosamente.

En modo `google`, el endpoint predeterminado es el host oficial
`generativelanguage.googleapis.com`, sin redirecciones. Un endpoint distinto
se rechaza salvo que el operador configure simultáneamente
`AIMAUTA_GEMINI_ENDPOINT` y el opt-in exacto
`AIMAUTA_ALLOW_NON_GOOGLE_GEMINI_ENDPOINT=true`; ese modo entrega la clave y
las páginas al host configurado y no debe usarse sin una revisión contractual
y técnica independiente.

No publica nada. Después de revisar y cambiar explícitamente los estados y
marcas `reviewed`, valide el par que se propone promover:

```bash
npm run exercises:validate -- \
  --public "$job_dir/<bookId>.public.reviewed.json" \
  --private "$job_dir/<bookId>.private.reviewed.json"
```

La validación exige que ya no queden elementos `draft`/`review`, que exista al
menos un ejercicio `published` y que cada solución publicada esté revisada y
en la misma revisión.

Guarde el par aprobado con los nombres y modos exactos que consume la
promoción:

```text
jobs/<job_id>/<bookId>.public.reviewed.json   0600
jobs/<job_id>/<bookId>.private.reviewed.json  0600
jobs/<job_id>/<bookId>.ingestion-report.json  0600
```

La promoción vuelve a validar y vincular el reporte con `bookId`, checksum,
modelo, fecha, páginas y número de ejercicios del manifiesto revisado. Si el
reporte falta, no cubre cada página exactamente una vez o conserva cualquier
bloqueante, la publicación falla cerrada.

## Ejecución aislada

Cada ingesta debe ejecutarse como job asíncrono de un solo uso, iniciado desde
SSH. El runner debe:

- usar usuario no-root, rootfs de solo lectura, `no-new-privileges` y ninguna
  capability;
- montar con escritura únicamente `jobs/<job_id>`;
- renderizar el PDF sin red y dar red sólo al proceso que llama al proveedor;
- fijar límites de memoria, CPU, procesos, páginas, píxeles, tiempo y costo;
- mantener reintentos acotados e idempotencia por checksum y versión de
  pipeline;
- no montar el socket Docker ni los directorios publicados con escritura.

El API externo devuelve datos estructurados. El job conserva en revisión
rectángulos, respuesta verificada, pasos pedagógicos y pistas; no solicita ni
almacena chain-of-thought o razonamiento interno bruto.

La cuota actual de Gemma 4 en Gemini Developer API es gratuita y no ofrece
tier pagado. Según los términos del proveedor, el contenido de servicios no
pagados puede usarse para mejorar sus productos. Por eso este pipeline sólo
envía páginas de libros con licencia/procedencia ya revisada: nunca envía
intentos, nombres, voz, identificadores ni otros datos de estudiantes. Si ese
tratamiento deja de ser aceptable, se desactiva el proveedor antes de ingerir
nuevos libros y se sustituye por un endpoint con garantías contractuales
adecuadas.

## Revisión manual

El resultado pasa de `draft` a `review`, nunca directamente a `published`. Una
persona debe comprobar:

- cajas, rotación y páginas de cada ejercicio;
- agrupación de ejercicios multipágina;
- unidad y etapa curricular;
- respuesta, comprobación y escalera de pistas;
- licencia, edición, checksum y reporte de extracción.

Si se habilita una interfaz de revisión, debe ser un servicio separado ligado a
`127.0.0.1:3310` en PowerEdge. Se accede sólo mediante:

```bash
ssh -N -L 3310:127.0.0.1:3310 poweredge
```

Nunca se expone ese puerto mediante Funnel. Nginx devuelve `404` para
`/admin`, `/api/admin`, `/api/ingest` y `/api/upload`, incluidos sus
descendientes.

## Publicación y rollback

La aprobación produce un bundle autoritativo y dos mirrors operativos:

- `manifests/exercises/<bookId>.public.json`: regiones y texto visible;
- `exercise-solutions/<bookId>.private.json`: respuestas y pistas sólo para el
  servidor;
- `exercise-solutions/<bookId>.release.json`: ambas mitades validadas y
  revisionadas en un único archivo privado.

Antes de tomar el lock se validan ambos manifiestos juntos contra catálogo y
currículo. También se abre el PDF runtime sin seguir enlaces, se comprueban
dueño, modo `0640`, firma, bytes, SHA-256 y número físico de páginas, y se abre
el índice RAG real con las mismas garantías. El índice debe coincidir en
versión de extractor, libro, checksum fuente, páginas, taxonomía, currículo,
licencia, fragmentos y reporte de calidad. Los hashes verificados quedan en
`release.json`.

Después se escribe el bundle con nombre temporal, `fsync` y modo `0640`. Un
único `rename` activa a la vez la mitad pública y la solución privada. Los
lectores prefieren siempre ese bundle y sólo usan los dos archivos históricos
cuando todavía no existe uno; por ello, un crash mientras se refrescan los
mirrors no crea una ventana de revisiones mezcladas. Un bundle existente pero
inválido falla cerrado y nunca cae al formato anterior.

La promoción real acepta únicamente `job_id` y `bookId`; no acepta rutas
arbitrarias:

```bash
npm run exercises:promote -- \
  --job "$job_id" \
  --book fichas-matematica-1-secundaria
```

`AIMAUTA_RUNTIME_DIR` usa `/home/hii1sc/aimauta-runtime` de forma
predeterminada. Sus directorios deben existir, pertenecer al operador, no ser
enlaces y conservar modo `0750`; PDF e índices deben pertenecer al operador y
usar `0640`. El comando no crea raíces ni mounts. Adquiere un lock exclusivo,
guarda el par nuevo y el anterior bajo
`releases/<release_id>`, escribe y sincroniza temporales `0640` y activa el
bundle completo con un solo rename. Si una comprobación posterior falla,
restaura primero los mirrors y finalmente el bundle anterior. Un lock con más
de cinco minutos sólo se recupera si conserva dueño y modo seguros y el PID
registrado ya no existe.

Este comando sólo promueve manifiestos de ejercicios. Para cambios que también
incluyan PDF, índice o catálogo se prepara un release integral por separado y
se recrea la aplicación después de todas las validaciones. El worker de
ingesta nunca modifica el despliegue web.
