#!/usr/bin/env sh
set -euo pipefail

PORT=${PORT:-8080}
USE_UNIT=${USE_UNIT:-auto}
UNIT_STATE_DIR=${UNIT_STATE_DIR:-/app/unit}
UNIT_CONFIG_TEMPLATE=${UNIT_CONFIG_TEMPLATE:-/app/unit-config.json}
UNIT_CONFIG_PATH=${UNIT_CONFIG_PATH:-${UNIT_STATE_DIR}/runtime-unit-config.json}
UNIT_CONTROL_SOCKET=${UNIT_CONTROL_SOCKET:-/app/unit/control.sock}

UVICORN_CMD="uvicorn src.app:create_app --factory --host 0.0.0.0 --port ${PORT}"

# Allow forcing uvicorn for architectures without NGINX Unit
if [ "${USE_UNIT}" != "unit" ] && [ "${USE_UNIT}" != "auto" ]; then
  echo "USE_UNIT=${USE_UNIT}; starting uvicorn directly"
  exec ${UVICORN_CMD}
fi

if ! command -v unitd >/dev/null 2>&1; then
  if [ "${USE_UNIT}" = "unit" ]; then
    echo "ERROR: NGINX Unit requested but unitd is not installed" >&2
    exit 1
  fi
  echo "NGINX Unit not available; falling back to uvicorn"
  exec ${UVICORN_CMD}
fi

mkdir -p "${UNIT_STATE_DIR}/state"
rm -f "${UNIT_CONTROL_SOCKET}"

if [ ! -f "${UNIT_CONFIG_TEMPLATE}" ]; then
  echo "ERROR: Unit config template not found at ${UNIT_CONFIG_TEMPLATE}" >&2
  exit 1
fi

# Inject runtime port into Unit config
sed "s/__PORT__/${PORT}/g" "${UNIT_CONFIG_TEMPLATE}" > "${UNIT_CONFIG_PATH}"

unitd --no-daemon \
  --control "unix:${UNIT_CONTROL_SOCKET}" \
  --state "${UNIT_STATE_DIR}/state" \
  --pid "${UNIT_STATE_DIR}/unit.pid" \
  --log "${UNIT_STATE_DIR}/unit.log" &

UNIT_PID=$!
trap 'kill -TERM ${UNIT_PID} 2>/dev/null' TERM INT

# Wait for control socket to become available
for _ in $(seq 1 40); do
  if [ -S "${UNIT_CONTROL_SOCKET}" ]; then
    break
  fi
  sleep 0.25
done

if [ ! -S "${UNIT_CONTROL_SOCKET}" ]; then
  echo "ERROR: Unit control socket not available" >&2
  kill "${UNIT_PID}" >/dev/null 2>&1 || true
  exit 1
fi

# Load Unit configuration via control API
if ! curl --silent --show-error --fail \
  --unix-socket "${UNIT_CONTROL_SOCKET}" \
  -X PUT \
  -H "Content-Type: application/json" \
  --data-binary @"${UNIT_CONFIG_PATH}" \
  http://localhost/config; then
  echo "ERROR: Failed to load NGINX Unit configuration" >&2
  kill "${UNIT_PID}" >/dev/null 2>&1 || true
  exit 1
fi

wait "${UNIT_PID}"
