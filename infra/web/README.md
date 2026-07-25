# Despliegue web

La aplicación web usa dos contenedores permanentes sin privilegios y un
contenedor one-shot de migración, todos con sistema de archivos de solo lectura
y red del host:

- el migrador ejecuta `prisma migrate deploy` y debe terminar correctamente
  antes de iniciar Next.js;
- Next.js se liga exclusivamente a `127.0.0.1:3309` y alcanza el túnel privado
  de Ollama en `127.0.0.1:11435`;
- Nginx se liga exclusivamente a `127.0.0.1:3308` y es el único destino del
  proxy público.

El edge limita tamaño de cuerpos, solicitudes y conexiones por IP; rechaza
`/api/internal/turn`, elimina `CF-Connecting-IP` y `X-Real-IP` y reenvía
únicamente el `X-Forwarded-For` canónico escrito por Tailscale Funnel. Por esta
razón `AIMAUTA_TRUST_PROXY_HEADERS=true` solo es válido con esta topología y
Funnel nunca debe apuntar directamente al puerto 3309.

El reverse SSH usa una llave dedicada, distinta de la llave de Ollama. Se crea
una sola vez en PowerEdge, sin frase y con permisos `0600`:

```bash
ssh-keygen -t ed25519 -N '' \
  -C aimauta-poweredge-to-aule-edge \
  -f /home/hii1sc/.ssh/aimauta_aule_edge_ed25519
```

El operador de Aule verifica la huella pública y autoriza esa llave con la línea
cerrada siguiente (sustituyendo únicamente la parte `ssh-ed25519 ...`):

```text
from="<IP-Tailscale-actual-de-PowerEdge>",restrict,port-forwarding,permitlisten="127.0.0.1:3308",permitopen="127.0.0.1:9",command="/bin/false" ssh-ed25519 <clave-pública> aimauta-poweredge-to-aule-edge
```

Así la credencial no permite shell, otros listeners remotos ni destinos de
forward locales útiles. La IP se obtiene con `tailscale ip -4`, no se copia de
una guía anterior. La llave privada nunca se copia a Aule ni al repositorio.

En PowerEdge, primero se validan y confirman los cambios en
`/home/hii1sc/aimauta-production`. Después se crea mediante `git archive` el
release inmutable documentado en
[`docs/DEPLOYMENT.md`](../../docs/DEPLOYMENT.md). Los contenedores nunca se
construyen desde un checkout con cambios locales:

```bash
release_id="$(git -C /home/hii1sc/aimauta-production rev-parse --short HEAD)"
release_dir="/home/hii1sc/aimauta-releases/${release_id}"
test -d "$release_dir"

if [ ! -e /home/hii1sc/aimauta-runtime/web.env ]; then
  "$release_dir/infra/web/init-env.sh" \
    /home/hii1sc/aimauta-runtime/web.env
fi

AIMAUTA_RELEASE="$release_id" \
  AIMAUTA_WEB_ENV_FILE=/home/hii1sc/aimauta-runtime/web.env \
  AIMAUTA_RUNTIME_DIR=/home/hii1sc/aimauta-runtime \
  docker compose -f "$release_dir/infra/web/compose.yaml" build --pull

AIMAUTA_RELEASE="$release_id" \
  AIMAUTA_WEB_ENV_FILE=/home/hii1sc/aimauta-runtime/web.env \
  AIMAUTA_RUNTIME_DIR=/home/hii1sc/aimauta-runtime \
  docker compose -f "$release_dir/infra/web/compose.yaml" \
  up -d --no-build --force-recreate

# Los túneles son configuración administrada por el host y no se reinstalan
# durante una promoción de la aplicación.
systemctl --user is-active \
  aimauta-aule-ollama-tunnel.service \
  aimauta-aule-edge-tunnel.service

# En Aule (Tailscale >= 1.98.9):
tailscale version
tailscale funnel --yes --bg --https=8443 http://127.0.0.1:3308
```

El archivo de entorno se crea una sola vez, con permisos `0600`, sin imprimir
los secretos. Antes del primer inicio se completan `DATABASE_URL` y
`AIMAUTA_PUBLIC_URL`; el inicializador deja ambos vacíos deliberadamente para
no inventar el DSN ni el dominio público. Los PDF, índices y manifiestos se
montan en modo de solo lectura.
`restart: unless-stopped` mantiene los contenedores después de reinicios del
daemon. El usuario de PowerEdge debe tener `Linger=yes` para que el túnel
systemd continúe sin una sesión SSH. En esta máquina las unidades instaladas
usan `/home/hii1sc/.ssh/aimauta_aule_direct_config` y difieren de las plantillas
del repositorio; solo se actualizan en una ventana de mantenimiento de red. La
configuración de Funnel queda administrada por el `tailscaled` corregido de
Aule; su versión se verifica en ese nodo y no se debe activar Funnel en un
daemon afectado por
[TS-2026-008](https://tailscale.com/security-bulletins#ts-2026-008).

Antes de promocionar una imagen deben pasar:

```bash
npm run catalog:validate
npm run typecheck
npm run lint
npm test
npm run audit:production
sh -n infra/ingest/init-runtime.sh
AIMAUTA_RELEASE="$release_id" \
  AIMAUTA_WEB_ENV_FILE=/home/hii1sc/aimauta-runtime/web.env \
  AIMAUTA_RUNTIME_DIR=/home/hii1sc/aimauta-runtime \
  docker compose -f "$release_dir/infra/web/compose.yaml" config --quiet
curl --fail http://127.0.0.1:3308/_edge-health
```

Este perfil publica texto y PDF. La vista previa silenciosa del avatar queda
cerrada con `AIMAUTA_AVATAR_ENABLED=false`; al cambiarla al valor exacto `true`
se muestra únicamente en URLs de aprendizaje con `?avatar=1`.

La voz queda deshabilitada de forma independiente con
`AIMAUTA_VOICE_TUTOR_ENABLED=false`. Para habilitarla se debe desplegar
LiveKit/worker, añadir al entorno web `LIVEKIT_URL`, `LIVEKIT_API_URL`,
`LIVEKIT_API_KEY` y `LIVEKIT_API_SECRET`, y cambiar la bandera al valor exacto
`true`. El worker debe usar `AIMAUTA_APP_URL=http://127.0.0.1:3309` y
exactamente el mismo `AIMAUTA_AGENT_SECRET` del archivo web; el worker evita
deliberadamente el edge público.
