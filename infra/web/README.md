# Despliegue web

La aplicación web se ejecuta como dos contenedores sin privilegios, con sistema
de archivos de solo lectura y red del host:

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
from="100.120.80.60",restrict,port-forwarding,permitlisten="127.0.0.1:3308",permitopen="127.0.0.1:9",command="/bin/false" ssh-ed25519 <clave-pública> aimauta-poweredge-to-aule-edge
```

Así la credencial no permite shell, otros listeners remotos ni destinos de
forward locales útiles. La llave privada nunca se copia a Aule ni al
repositorio.

En PowerEdge, desde un checkout limpio:

```bash
chmod +x infra/web/init-env.sh
infra/web/init-env.sh /home/hii1sc/aimauta-runtime/web.env

AIMAUTA_RELEASE="$(git rev-parse --short HEAD)" \
  docker compose -f infra/web/compose.yaml build

AIMAUTA_RELEASE="$(git rev-parse --short HEAD)" \
  docker compose -f infra/web/compose.yaml up -d

# En PowerEdge: mantener el reverse SSH hacia Aule
install -m 600 infra/web/aimauta-aule-ollama-tunnel.service \
  /home/hii1sc/.config/systemd/user/aimauta-aule-ollama-tunnel.service
install -m 600 infra/web/aimauta-aule-edge-tunnel.service \
  /home/hii1sc/.config/systemd/user/aimauta-aule-edge-tunnel.service
systemctl --user daemon-reload
systemctl --user enable --now aimauta-aule-ollama-tunnel.service
systemctl --user enable --now aimauta-aule-edge-tunnel.service

# En Aule (Tailscale >= 1.98.9):
tailscale funnel --yes --bg --https=8443 http://127.0.0.1:3308
```

El archivo de entorno se crea una sola vez, con permisos `0600`, sin imprimir
los secretos. Los PDF, índices y manifiestos se montan en modo de solo lectura.
`restart: unless-stopped` mantiene los contenedores después de reinicios del
daemon. El usuario de PowerEdge debe tener `Linger=yes` para que el túnel
systemd continúe sin una sesión SSH. La configuración de Funnel queda
administrada por el `tailscaled` corregido de Aule; no se debe activar Funnel en
un daemon afectado por TS-2026-008.

Antes de promocionar una imagen deben pasar:

```bash
npm run catalog:validate
npm run typecheck
npm run lint
npm test
docker compose -f infra/web/compose.yaml config --quiet
curl --fail http://127.0.0.1:3308/_edge-health
```

Este perfil publica texto y PDF. La voz queda deshabilitada de forma explícita
hasta desplegar LiveKit/worker y añadir al entorno web `LIVEKIT_URL`,
`LIVEKIT_API_URL`, `LIVEKIT_API_KEY` y `LIVEKIT_API_SECRET`. Al habilitarla, el
worker debe usar `AIMAUTA_APP_URL=http://127.0.0.1:3309` y exactamente el mismo
`AIMAUTA_AGENT_SECRET` del archivo web; el worker evita deliberadamente el edge
público.
