#!/bin/sh
set -eu

usage() {
  printf '%s\n' \
    "Uso: $0 RUTA_ENV" \
    "Ejemplo: $0 /home/hii1sc/aimauta-runtime/web.env" >&2
  exit 2
}

[ "$#" -eq 1 ] || usage

target=$1
[ "$(id -u)" -gt 0 ] && [ "$(id -g)" -gt 0 ] || {
  printf '%s\n' "Ejecute este script como el operador no-root, sin sudo." >&2
  exit 2
}
[ ! -e "$target" ] || {
  printf '%s\n' "La ruta ya existe; no se sobrescribió: $target" >&2
  exit 1
}
command -v openssl >/dev/null 2>&1 || {
  printf '%s\n' "Se requiere openssl para generar las credenciales." >&2
  exit 1
}

target_dir=$(dirname "$target")
umask 077
mkdir -p "$target_dir"
env_tmp=$(mktemp "$target_dir/.aimauta-web.env.XXXXXX")
cleanup() {
  rm -f "$env_tmp"
}
trap cleanup EXIT HUP INT TERM

session_secret=$(openssl rand -hex 32)
agent_secret=$(openssl rand -hex 32)

{
  printf '%s\n' \
    "AIMAUTA_CONTENT_DIR=/srv/aimauta/content" \
    "AIMAUTA_INDEX_DIR=/srv/aimauta/indexes" \
    "AIMAUTA_MANIFEST_DIR=/srv/aimauta/manifests" \
    "AIMAUTA_REMOTE_CONTENT_PROXY=false" \
    "AIMAUTA_TRUST_PROXY_HEADERS=true" \
    "AIMAUTA_SESSION_SECRET=$session_secret" \
    "AIMAUTA_AGENT_SECRET=$agent_secret" \
    "OLLAMA_BASE_URL=http://127.0.0.1:11435" \
    "OLLAMA_MODEL=gemma4:e4b-it-qat" \
    "OLLAMA_TIMEOUT_MS=45000" \
    "LIVEKIT_URL=" \
    "LIVEKIT_API_URL=" \
    "LIVEKIT_API_KEY=" \
    "LIVEKIT_API_SECRET="
} >"$env_tmp"
chmod 600 "$env_tmp"

if ! ln "$env_tmp" "$target" 2>/dev/null; then
  printf '%s\n' "La ruta apareció durante la creación; no se sobrescribió: $target" >&2
  exit 1
fi
rm -f "$env_tmp"
trap - EXIT HUP INT TERM

printf '%s\n' "Entorno web creado con permisos 600: $target"
printf '%s\n' "Las credenciales no se imprimieron."
