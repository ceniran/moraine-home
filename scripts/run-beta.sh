#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
if [ -f "${project_dir}/.env" ]; then
  set -a
  # The file is user-owned local configuration and is never committed.
  . "${project_dir}/.env"
  set +a
fi
export PYTHONPATH="${project_dir}/src${PYTHONPATH:+:${PYTHONPATH}}"
export MORAINE_BETA_DATA_FILE="${MORAINE_BETA_DATA_FILE:-${project_dir}/data/beta-store.json}"
export MORAINE_BETA_SEED_FILE="${MORAINE_BETA_SEED_FILE:-${project_dir}/src/moraine/data/beta-seed.json}"
export MORAINE_BETA_WEB_ROOT="${MORAINE_BETA_WEB_ROOT:-${project_dir}/src/moraine/static}"

exec python3 -m moraine.beta_server
