#!/bin/sh
set -eu

usage() {
  printf '%s\n' \
    "Uso: $0 RUTA_ENV DOMINIO_WSS DOMINIO_TURN IPV4_PUBLICA" \
    "Ejemplo: $0 /home/aimauta/secrets/livekit.env livekit.example.edu turn.example.edu 203.0.113.10" >&2
  exit 2
}

[ "$#" -eq 4 ] || usage

target=$1
livekit_domain=$2
turn_domain=$3
node_ip=$4

domain_pattern='^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$'

printf '%s\n' "$livekit_domain" | grep -Eq "$domain_pattern" || {
  printf '%s\n' "Dominio WSS inválido." >&2
  exit 2
}
printf '%s\n' "$turn_domain" | grep -Eq "$domain_pattern" || {
  printf '%s\n' "Dominio TURN inválido." >&2
  exit 2
}
[ "$livekit_domain" != "$turn_domain" ] || {
  printf '%s\n' "WSS y TURN requieren dominios distintos." >&2
  exit 2
}
[ "$(id -u)" -gt 0 ] && [ "$(id -g)" -gt 0 ] || {
  printf '%s\n' "Ejecute este script como el operador no-root, sin sudo." >&2
  exit 2
}

old_ifs=$IFS
IFS=.
set -- $node_ip
IFS=$old_ifs
[ "$#" -eq 4 ] || {
  printf '%s\n' "IPv4 pública inválida." >&2
  exit 2
}
for octet in "$@"; do
  case $octet in
    ''|*[!0-9]*)
      printf '%s\n' "IPv4 pública inválida." >&2
      exit 2
      ;;
  esac
  [ "$octet" -le 255 ] || {
    printf '%s\n' "IPv4 pública inválida." >&2
    exit 2
  }
done

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
env_tmp=$(mktemp "$target_dir/.livekit.env.XXXXXX")
cleanup() {
  rm -f "$env_tmp"
}
trap cleanup EXIT HUP INT TERM

api_key="API$(openssl rand -hex 12)"
api_secret=$(openssl rand -hex 32)
runtime_uid=$(id -u)
runtime_gid=$(id -g)

{
  printf 'LIVEKIT_DOMAIN=%s\n' "$livekit_domain"
  printf 'LIVEKIT_TURN_DOMAIN=%s\n' "$turn_domain"
  printf 'LIVEKIT_NODE_IP=%s\n' "$node_ip"
  printf 'LIVEKIT_RUNTIME_UID=%s\n' "$runtime_uid"
  printf 'LIVEKIT_RUNTIME_GID=%s\n' "$runtime_gid"
  printf 'LIVEKIT_API_KEY=%s\n' "$api_key"
  printf 'LIVEKIT_API_SECRET=%s\n' "$api_secret"
} >"$env_tmp"
chmod 600 "$env_tmp"

# A hard link publishes the fully written file atomically and fails if another
# process created the destination after the initial check.
if ! ln "$env_tmp" "$target" 2>/dev/null; then
  printf '%s\n' "La ruta apareció durante la creación; no se sobrescribió: $target" >&2
  exit 1
fi
rm -f "$env_tmp"
trap - EXIT HUP INT TERM

printf '%s\n' "Entorno creado con permisos 600: $target"
printf '%s\n' "Las credenciales no se imprimieron. Cópielas solo a los procesos AImauta autorizados."
