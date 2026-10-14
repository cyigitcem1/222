#!/usr/bin/env bash
set -euo pipefail
umask 077
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
node scripts/gideon.mjs openclaw config validate
gideon_log_dir="${GIDEON_STATE_DIR:-$PWD/.gideon}/logs"
gideon_log_file="$gideon_log_dir/cloud-launcher.log"
if [[ -L "$gideon_log_file" ]]; then
  echo 'GIDEON: günlük yolu sembolik bağlantı olamaz.' >&2
  exit 1
fi
if ! node scripts/gideon.mjs openclaw health --json >/dev/null 2>&1; then
  GIDEON_NO_OPEN=1 nohup node scripts/gideon.mjs start >"$gideon_log_file" 2>&1 </dev/null &
  gideon_launcher_pid=$!
  for gideon_attempt in {1..30}; do
    if node scripts/gideon.mjs openclaw health --json >/dev/null 2>&1; then
      node scripts/gideon.mjs doctor
      exit 0
    fi
    if ! kill -0 "$gideon_launcher_pid" 2>/dev/null; then
      echo 'GIDEON başlatılamadı; özel logs/cloud-launcher.log dosyasını inceleyin.' >&2
      exit 1
    fi
    sleep 1
  done
  echo 'GIDEON hazır duruma gelmedi; özel logs/cloud-launcher.log dosyasını inceleyin.' >&2
  exit 1
fi
node scripts/gideon.mjs doctor
