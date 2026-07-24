#!/bin/sh
set -eu

usage() {
  printf '%s\n' "Uso: $0 RUTA_ENV" >&2
  exit 2
}

[ "$#" -eq 1 ] || usage
env_file=$1
[ -f "$env_file" ] || {
  printf '%s\n' "No existe el archivo de entorno: $env_file" >&2
  exit 1
}
env_mode=$(stat -c %a "$env_file")
case $env_mode in
  400|600) ;;
  *)
    printf '%s\n' "El archivo de entorno debe tener modo 400 o 600." >&2
    exit 1
    ;;
esac
[ "$(stat -c %u "$env_file")" -eq "$(id -u)" ] || {
  printf '%s\n' "El archivo de entorno debe pertenecer al usuario actual." >&2
  exit 1
}

read_value() {
  key=$1
  matches=$(grep -E "^${key}=" "$env_file" || true)
  [ "$(printf '%s\n' "$matches" | sed '/^$/d' | wc -l | tr -d ' ')" -eq 1 ] || {
    printf '%s\n' "Se requiere exactamente una entrada ${key}= en $env_file." >&2
    exit 1
  }
  value=${matches#*=}
  [ -n "$value" ] || {
    printf '%s\n' "${key} no puede estar vacío." >&2
    exit 1
  }
  printf '%s' "$value"
}

livekit_domain=$(read_value LIVEKIT_DOMAIN)
turn_domain=$(read_value LIVEKIT_TURN_DOMAIN)
node_ip=$(read_value LIVEKIT_NODE_IP)
runtime_uid=$(read_value LIVEKIT_RUNTIME_UID)
runtime_gid=$(read_value LIVEKIT_RUNTIME_GID)
api_key=$(read_value LIVEKIT_API_KEY)
api_secret=$(read_value LIVEKIT_API_SECRET)

domain_pattern='^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$'
printf '%s\n' "$livekit_domain" | grep -Eq "$domain_pattern" || {
  printf '%s\n' "LIVEKIT_DOMAIN inválido." >&2
  exit 1
}
printf '%s\n' "$turn_domain" | grep -Eq "$domain_pattern" || {
  printf '%s\n' "LIVEKIT_TURN_DOMAIN inválido." >&2
  exit 1
}
[ "$livekit_domain" != "$turn_domain" ] || {
  printf '%s\n' "WSS y TURN requieren dominios distintos." >&2
  exit 1
}
printf '%s\n' "$node_ip" | grep -Eq '^([0-9]{1,3}\.){3}[0-9]{1,3}$' || {
  printf '%s\n' "LIVEKIT_NODE_IP debe ser una IPv4." >&2
  exit 1
}
old_ifs=$IFS
IFS=.
set -- $node_ip
IFS=$old_ifs
for octet in "$@"; do
  [ "$octet" -le 255 ] || {
    printf '%s\n' "LIVEKIT_NODE_IP debe ser una IPv4." >&2
    exit 1
  }
done
printf '%s\n' "$runtime_uid" | grep -Eq '^[1-9][0-9]*$' || {
  printf '%s\n' "LIVEKIT_RUNTIME_UID debe ser un UID no-root." >&2
  exit 1
}
printf '%s\n' "$runtime_gid" | grep -Eq '^[1-9][0-9]*$' || {
  printf '%s\n' "LIVEKIT_RUNTIME_GID debe ser un GID no-root." >&2
  exit 1
}
[ "$runtime_uid" -eq "$(id -u)" ] && [ "$runtime_gid" -eq "$(id -g)" ] || {
  printf '%s\n' "LIVEKIT_RUNTIME_UID/GID deben corresponder al operador actual." >&2
  exit 1
}
printf '%s\n' "$api_key" | grep -Eq '^API[A-Za-z0-9_-]{16,61}$' || {
  printf '%s\n' "LIVEKIT_API_KEY tiene un formato inseguro o inválido." >&2
  exit 1
}
printf '%s\n' "$api_secret" | grep -Eq '^[A-Za-z0-9_-]{32,128}$' || {
  printf '%s\n' "LIVEKIT_API_SECRET tiene un formato inseguro o inválido." >&2
  exit 1
}

script_dir=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
runtime_dir=$script_dir/runtime
umask 077
mkdir -p "$runtime_dir/caddy-data"
chmod 700 "$runtime_dir" "$runtime_dir/caddy-data"

livekit_tmp=$(mktemp "$runtime_dir/livekit.yaml.XXXXXX")
caddy_tmp=$(mktemp "$runtime_dir/caddy.yaml.XXXXXX")
keys_tmp=$(mktemp "$runtime_dir/livekit.keys.XXXXXX")
cleanup() {
  rm -f "$livekit_tmp" "$caddy_tmp" "$keys_tmp"
}
trap cleanup EXIT HUP INT TERM

sed \
  -e "s/__LIVEKIT_NODE_IP__/${node_ip}/g" \
  -e "s/__LIVEKIT_TURN_DOMAIN__/${turn_domain}/g" \
  "$script_dir/livekit.yaml.template" >"$livekit_tmp"
sed \
  -e "s/__LIVEKIT_DOMAIN__/${livekit_domain}/g" \
  -e "s/__LIVEKIT_TURN_DOMAIN__/${turn_domain}/g" \
  "$script_dir/caddy.yaml.template" >"$caddy_tmp"
printf '%s: %s\n' "$api_key" "$api_secret" >"$keys_tmp"

chmod 444 "$livekit_tmp" "$caddy_tmp"
chmod 400 "$keys_tmp"
mv -f "$livekit_tmp" "$runtime_dir/livekit.yaml"
mv -f "$caddy_tmp" "$runtime_dir/caddy.yaml"
mv -f "$keys_tmp" "$runtime_dir/livekit.keys"
trap - EXIT HUP INT TERM

printf '%s\n' "Configuración generada en $runtime_dir."
printf '%s\n' "No se imprimieron credenciales."
