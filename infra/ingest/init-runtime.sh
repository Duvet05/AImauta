#!/bin/sh
set -eu

operator_name=hii1sc
ingest_root=/home/hii1sc/aimauta-ingest
runtime_root=/home/hii1sc/aimauta-runtime
operator_uid=$(id -u)

if [ "$#" -ne 0 ]; then
  printf '%s\n' "Uso: $0" >&2
  exit 2
fi

if [ "$(id -u)" -eq 0 ] || [ "$(id -un)" != "$operator_name" ]; then
  printf '%s\n' \
    "Ejecute este script como $operator_name, sin sudo." >&2
  exit 2
fi

for required_command in install stat
do
  command -v "$required_command" >/dev/null 2>&1 || {
    printf '%s\n' "Se requiere el comando $required_command." >&2
    exit 1
  }
done

umask 077

ensure_directory() {
  directory=$1
  mode=$2

  if [ -L "$directory" ]; then
    printf '%s\n' "Se rechazó un enlace simbólico: $directory" >&2
    exit 1
  fi
  if [ -e "$directory" ] && [ ! -d "$directory" ]; then
    printf '%s\n' "La ruta existe y no es un directorio: $directory" >&2
    exit 1
  fi

  install -d -m "$mode" -- "$directory"
  if [ "$(stat -c %u -- "$directory")" -ne "$operator_uid" ]; then
    printf '%s\n' \
      "El directorio no pertenece a $operator_name: $directory" >&2
    exit 1
  fi
  chmod "$mode" -- "$directory"
}

normalize_runtime_file() {
  runtime_file=$1

  if [ -L "$runtime_file" ]; then
    printf '%s\n' "Se rechazó un enlace simbólico: $runtime_file" >&2
    exit 1
  fi
  if [ ! -e "$runtime_file" ]; then
    return
  fi
  if [ ! -f "$runtime_file" ]; then
    printf '%s\n' \
      "El artefacto runtime no es un archivo regular: $runtime_file" >&2
    exit 1
  fi
  if [ "$(stat -c %u -- "$runtime_file")" -ne "$operator_uid" ]; then
    printf '%s\n' \
      "El artefacto runtime no pertenece a $operator_name: $runtime_file" >&2
    exit 1
  fi
  chmod 0640 -- "$runtime_file"
}

ensure_directory "$ingest_root" 0700
ensure_directory "$ingest_root/inbox" 0700
ensure_directory "$ingest_root/jobs" 0700
ensure_directory "$ingest_root/secrets" 0700

ensure_directory "$runtime_root" 0750
ensure_directory "$runtime_root/content" 0750
ensure_directory "$runtime_root/indexes" 0750
ensure_directory "$runtime_root/manifests" 0750
ensure_directory "$runtime_root/manifests/exercises" 0750
ensure_directory "$runtime_root/exercise-solutions" 0750
ensure_directory "$runtime_root/releases" 0750

for runtime_file in \
  "$runtime_root/content/"*.pdf \
  "$runtime_root/indexes/"*.json
do
  normalize_runtime_file "$runtime_file"
done

printf '%s\n' \
  "Directorios privados de ingesta inicializados en $ingest_root." \
  "Directorios runtime y artefactos existentes normalizados en $runtime_root." \
  "No se creó ni se imprimió ninguna credencial."
