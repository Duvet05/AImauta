# LiveKit self-hosted de AImauta

Este directorio define el MVP de LiveKit Server en un único nodo Linux. No
incluye LiveKit Cloud, Redis, Ingress, Egress, SIP ni grabaciones. El servidor
es Apache-2.0 y las imágenes se fijan por versión, plataforma y digest.

El despliegue activo usa LiveKit Cloud. El worker actual consume LiveKit
Inference y no puede autenticarse allí con las claves de este servidor
self-hosted; esta pila queda como alternativa de infraestructura, no como un
procedimiento completo de voz, hasta implementar credenciales de inferencia
separadas o un proveedor STT/TTS directo.

Al no usar Redis ni una segunda instancia, las salas, dispatches y conexiones
son efímeros: reiniciar el nodo termina las sesiones de voz activas. Esta
topología no ofrece alta disponibilidad ni un SLA y debe ampliarse antes de un
uso institucional.

LiveKit y Caddy registran únicamente `WARN` o superior. Docker rota cada log en
tres archivos de 10 MB; aun así, una advertencia puede contener dominios o
identificadores seudónimos de sala. Antes del piloto se define una retención
breve, acceso restringido y eliminación, y no se habilita un exportador de logs
o telemetría.

## Frontera de red

```text
Navegador ─ WSS/TLS :443 ─┐
Cliente ─ TURN/TLS :443 ──┤ Caddy L4 ─┬─ 127.0.0.1:7880 LiveKit
                          │           └─ 127.0.0.1:5349 TURN interno
WebRTC ─ TCP :7881 ───────┤
WebRTC ─ UDP :7882 ───────┤ LiveKit
TURN ─── UDP :3478 ───────┘

Next.js/worker ─ HTTP/WS 127.0.0.1:7880
```

La URL pública del navegador es `wss://<LIVEKIT_DOMAIN>`. Next.js usa
`LIVEKIT_API_URL=http://127.0.0.1:7880` y el worker local usa
`LIVEKIT_URL=ws://127.0.0.1:7880`; así no dependen del DNS público ni recorren
Internet para operar el plano administrativo. LiveKit fija el listener 7880 a
`127.0.0.1`; el firewall debe rechazar desde interfaces externas el upstream
TURN sin TLS 5349. El endpoint público de señalización comparte el proceso
LiveKit y conserva sus APIs autenticadas; ningún secreto de administrador se
entrega al navegador.

## Condiciones previas

- host Linux AMD64 con Docker Engine y Compose v2;
- IPv4 pública estática, o NAT uno-a-uno con *port forwarding* que preserve
  exactamente los puertos documentados;
- dos nombres DNS distintos que apunten a esa IPv4:
  `livekit.<dominio>` y `turn.<dominio>`;
- TCP 443 y 7881, y UDP 3478 y 7882 alcanzables desde Internet;
- ausencia de CGNAT o NAT simétrico.

Si PowerEdge no cumple estas condiciones, esta misma pila debe ejecutarse en
una VM pública administrada por el equipo. Tailscale Funnel y un proxy HTTP
convencional no transportan por sí solos ICE/TURN UDP.

## Preparación sin publicar

Ejecutar en el nodo Linux, nunca en la Mac:

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

docker compose \
  --env-file /home/hii1sc/aimauta-runtime/livekit.env \
  -f infra/livekit/compose.yaml \
  run --rm --no-deps caddy \
  validate --config /etc/caddy/caddy.yaml --adapter yaml
```

`init-env.sh` crea una API key y un secreto aleatorios, registra el UID/GID no
root del operador y aplica modo `600`. Se niega a sobrescribir un archivo
existente y nunca imprime las credenciales. `render-config.sh` valida todos los
campos y monta la key pair en `runtime/livekit.keys`; no la expone en el entorno
del contenedor ni en `docker inspect`.

Los artefactos bajo `runtime/` están ignorados por Git. Deben pertenecer al
usuario indicado por `LIVEKIT_RUNTIME_UID/GID`. Caddy persiste certificados en
`runtime/caddy-data`; esa carpeta es privada y debe incluirse en el respaldo
operativo del nodo, no en el repositorio.

## Entornos de aplicación

Copiar la misma API key y el mismo secreto desde el archivo protegido, sin
pegarlos en la terminal compartida ni en logs.

Next.js:

```dotenv
LIVEKIT_URL=wss://livekit.ejemplo.edu
LIVEKIT_API_URL=http://127.0.0.1:7880
LIVEKIT_API_KEY=<valor-del-archivo-protegido>
LIVEKIT_API_SECRET=<valor-del-archivo-protegido>
```

Worker local:

```dotenv
LIVEKIT_URL=ws://127.0.0.1:7880
LIVEKIT_API_KEY=<valor-del-archivo-protegido>
LIVEKIT_API_SECRET=<valor-del-archivo-protegido>
```

El MVP admite un solo par. Su rotación requiere una ventana breve sin sesiones:
detener nuevas admisiones, reemplazar ambos valores en los archivos protegidos,
volver a renderizar, reiniciar LiveKit, Next.js y el worker como una unidad y
ejecutar el smoke de voz. La rotación invalida los JWT emitidos con el par
anterior; no se realiza durante sesiones activas.

## Firewall

La política de entrada debe ser `deny` por defecto. La tabla mínima es:

| Puerto | Protocolo | Origen | Uso |
| ---: | --- | --- | --- |
| 443 | TCP | Internet | WSS y TURN/TLS diferenciados por SNI |
| 7881 | TCP | Internet | ICE/TCP cuando UDP falla |
| 3478 | UDP | Internet | TURN/UDP y STUN autenticado |
| 7882 | UDP | Internet | ICE/UDP multiplexado |
| 7880 | TCP | solo loopback, impuesto por LiveKit | señal/API administrativa |
| 5349 | TCP | solo loopback | upstream TURN/TLS ya terminado |

No se abre un rango UDP adicional en esta configuración. `udp_port: 7882`
prioriza una superficie pequeña para el piloto de audio; antes de ampliar una
clase se realizan pruebas de carga. LiveKit recomienda varios puertos UDP,
idealmente al menos tantos como vCPU, para mayor capacidad.

Las reglas se aplican en el firewall del sistema **y** en el firewall/NAT del
proveedor. No se ejecutan automáticamente desde el repositorio porque una regla
incorrecta podría cortar SSH. Antes de iniciar, comprobar desde otra red que
7880 y 5349 no sean alcanzables.

El fragmento [`aimauta-livekit.nft`](aimauta-livekit.nft) agrega una tabla
aislada con política `accept` y descarta exclusivamente TCP 7880/5349 recibido
fuera de loopback; no modifica SSH, WebRTC 7881 ni UDP. En un host que ya usa
nftables, un administrador debe integrarlo en la configuración persistente y
validar el ruleset completo antes de cargarlo:

```bash
sudo nft --check --file infra/livekit/aimauta-livekit.nft
sudo nft --file infra/livekit/aimauta-livekit.nft
sudo nft list table inet aimauta_livekit_guard
```

La segunda carga directa fallará porque la tabla ya existe; las actualizaciones
deben realizarse desde el ruleset persistente que el sistema vacía y reconstruye
de forma atómica. No se debe añadir un `flush ruleset` a este fragmento.

## Inicio, salud y parada

Solo después de verificar DNS, firewall y consentimiento del piloto:

```bash
docker compose \
  --env-file /home/hii1sc/aimauta-runtime/livekit.env \
  -f infra/livekit/compose.yaml \
  pull

docker compose \
  --env-file /home/hii1sc/aimauta-runtime/livekit.env \
  -f infra/livekit/compose.yaml \
  up -d

docker compose \
  --env-file /home/hii1sc/aimauta-runtime/livekit.env \
  -f infra/livekit/compose.yaml \
  ps
```

El healthcheck de LiveKit consulta `127.0.0.1:7880`; el de Caddy comprueba su
listener local 443. La validación externa debe comprobar además:

```bash
curl --fail --show-error https://livekit.ejemplo.edu/
openssl s_client \
  -connect turn.ejemplo.edu:443 \
  -servername turn.ejemplo.edu \
  -verify_return_error </dev/null
```

Desde otra red también se comprueba que TCP 7880/5349 estén cerrados. Si
cualquiera responde, no se habilita el piloto.

La prueba funcional final usa `lk room join` desde una red externa y confirma
en `webrtc-internals` que existe candidato UDP o fallback TURN/TLS. Una
respuesta HTTPS saludable no demuestra por sí sola que WebRTC atraviese el
firewall.

Para detener sin borrar certificados:

```bash
docker compose \
  --env-file /home/hii1sc/aimauta-runtime/livekit.env \
  -f infra/livekit/compose.yaml \
  down
```

No usar `down -v` ni borrar `runtime/caddy-data` durante una actualización.

## Actualizaciones reproducibles

Las referencias actuales son:

- `livekit/livekit-server:v1.13.1`, digest AMD64
  `sha256:4d1cc81b039b236b2b2580714cb5d89321a7313e604274f7131cf76f7a43ef80`;
- `livekit/caddyl4:v2.11.3`, digest AMD64
  `sha256:b7f1781f901d9d289fa1b7452fe0d051ec0aba2386bf1ff42a0ee3400de1f143`.

Para actualizar, revisar primero las notas oficiales, resolver el manifiesto
AMD64 en PowerEdge, cambiar versión y digest juntos, validar configuración y
realizar una prueba WebRTC antes de sustituir el servicio. Nunca se usa
`latest` ni una etiqueta sin digest en producción.

Referencias upstream:

- [despliegue self-hosted de LiveKit](https://docs.livekit.io/transport/self-hosting/deployment/);
- [puertos y firewall](https://docs.livekit.io/transport/self-hosting/ports-firewall/);
- [despliegue oficial en VM](https://docs.livekit.io/transport/self-hosting/vm/);
- [releases de LiveKit Server](https://github.com/livekit/livekit/releases).
