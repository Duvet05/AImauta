#!/usr/bin/env bash
set -euo pipefail

TAVUS_ACTION="${1:-status}"
TAVUS_ENV_FILE="${AIMAUTA_VOICE_ENV_FILE:-/home/hii1sc/aimauta-runtime/voice-agent.env}"
TAVUS_CONTAINER="${AIMAUTA_VOICE_CONTAINER:-aimauta-voice-agent}"

read_flag() {
  awk -F= '
    $1 == "TAVUS_AVATAR_ENABLED" { print $2; found = 1; exit }
    END { if (!found) print "missing" }
  ' "$TAVUS_ENV_FILE"
}

show_status() {
  TAVUS_FLAG="$(read_flag)"
  if docker container inspect "$TAVUS_CONTAINER" >/dev/null 2>&1; then
    TAVUS_HEALTH="$(docker inspect \
      --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' \
      "$TAVUS_CONTAINER")"
  else
    TAVUS_HEALTH="missing"
  fi
  printf 'Tavus flag: %s · worker: %s\n' "$TAVUS_FLAG" "$TAVUS_HEALTH"
}

case "$TAVUS_ACTION" in
  status)
    test -f "$TAVUS_ENV_FILE"
    show_status
    exit 0
    ;;
  on)
    TAVUS_VALUE="true"
    ;;
  off)
    TAVUS_VALUE="false"
    ;;
  *)
    printf 'Uso: %s {on|off|status}\n' "$0" >&2
    exit 2
    ;;
esac

test -f "$TAVUS_ENV_FILE"
docker image inspect "$(
  docker inspect --format '{{.Config.Image}}' "$TAVUS_CONTAINER"
)" >/dev/null
TAVUS_IMAGE="$(docker inspect --format '{{.Config.Image}}' "$TAVUS_CONTAINER")"

TAVUS_TEMP_FILE="$(mktemp "${TAVUS_ENV_FILE}.tmp.XXXXXX")"
trap 'rm -f "$TAVUS_TEMP_FILE"' EXIT
awk -v value="$TAVUS_VALUE" '
  BEGIN { replaced = 0 }
  /^TAVUS_AVATAR_ENABLED=/ {
    if (!replaced) {
      print "TAVUS_AVATAR_ENABLED=" value
      replaced = 1
    }
    next
  }
  { print }
  END {
    if (!replaced) print "TAVUS_AVATAR_ENABLED=" value
  }
' "$TAVUS_ENV_FILE" > "$TAVUS_TEMP_FILE"
chmod 600 "$TAVUS_TEMP_FILE"
mv "$TAVUS_TEMP_FILE" "$TAVUS_ENV_FILE"
trap - EXIT

docker stop --time 30 "$TAVUS_CONTAINER" >/dev/null
docker rm "$TAVUS_CONTAINER" >/dev/null
docker run -d \
  --name "$TAVUS_CONTAINER" \
  --restart unless-stopped \
  --network host \
  --read-only \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  --pids-limit 512 \
  --stop-timeout 660 \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=256m,mode=1777 \
  --env-file "$TAVUS_ENV_FILE" \
  "$TAVUS_IMAGE" >/dev/null

for _ in $(seq 1 30); do
  TAVUS_HEALTH="$(docker inspect \
    --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' \
    "$TAVUS_CONTAINER")"
  if [ "$TAVUS_HEALTH" = "healthy" ] || [ "$TAVUS_HEALTH" = "running" ]; then
    show_status
    exit 0
  fi
  if [ "$TAVUS_HEALTH" = "unhealthy" ] || [ "$TAVUS_HEALTH" = "exited" ]; then
    break
  fi
  sleep 2
done

printf 'El worker no quedó saludable; revisa docker logs %s.\n' \
  "$TAVUS_CONTAINER" >&2
exit 1
