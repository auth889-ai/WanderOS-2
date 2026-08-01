#!/bin/bash
#
# Keep WanderOS reachable from the internet.
#
# A Cloudflare quick tunnel gives a real public HTTPS URL with no account and no
# signup, but it is fragile in one specific way: when the machine sleeps or a
# process dies, the tunnel drops AND the next one gets a DIFFERENT hostname.
# A URL that silently changes is worse than no URL, because whoever you gave it
# to gets a dead link rather than an error you can see.
#
# So this supervises all three processes, and whenever the tunnel hostname
# changes it writes the new one to PUBLIC_URL.txt and logs the change. The file
# is the single source of truth — read it, never remember the URL.
#
#   ./scripts/serve-public.sh          run in the foreground
#   ./scripts/serve-public.sh --quiet  no per-check output
#
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKER_DIR="$ROOT/media-worker"
URL_FILE="$ROOT/PUBLIC_URL.txt"
LOG_DIR="${TMPDIR:-/tmp}/wanderos"
NEXT_PORT=5050
WORKER_PORT=8000
QUIET=${1:-}

mkdir -p "$LOG_DIR"
export PATH="$HOME/bin:/opt/homebrew/bin:$PATH"

say() { [ "$QUIET" = "--quiet" ] || printf '%s  %s\n' "$(date '+%H:%M:%S')" "$*"; }

alive() { curl -sf -o /dev/null --max-time 5 "http://localhost:$1$2"; }

start_worker() {
  say "starting media worker on :$WORKER_PORT"
  (
    cd "$WORKER_DIR" || exit 1
    set -a; [ -f .env ] && . ./.env; set +a
    PYTHONPATH=. nohup .venv/bin/python -m uvicorn main:app \
      --port "$WORKER_PORT" --host 127.0.0.1 >"$LOG_DIR/worker.log" 2>&1 &
  )
}

start_next() {
  say "starting next on :$NEXT_PORT"
  ( cd "$ROOT" && nohup npx next start -p "$NEXT_PORT" >"$LOG_DIR/next.log" 2>&1 & )
}

start_tunnel() {
  say "opening cloudflare tunnel"
  : >"$LOG_DIR/tunnel.log"
  nohup cloudflared tunnel --url "http://localhost:$NEXT_PORT" \
    --no-autoupdate >"$LOG_DIR/tunnel.log" 2>&1 &

  # The hostname appears a few seconds after the process starts.
  for _ in $(seq 1 30); do
    sleep 2
    local url
    url=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG_DIR/tunnel.log" | head -1)
    if [ -n "$url" ]; then
      publish "$url"
      return 0
    fi
  done
  say "tunnel did not report a hostname within 60s — will retry"
  return 1
}

publish() {
  local url="$1"
  local previous=""
  [ -f "$URL_FILE" ] && previous=$(head -1 "$URL_FILE")

  if [ "$url" != "$previous" ]; then
    {
      echo "$url"
      echo ""
      echo "# Written $(date '+%Y-%m-%d %H:%M:%S')."
      echo "# A quick tunnel gets a NEW hostname every restart, so treat this"
      echo "# file as the source of truth and never a remembered URL."
      [ -n "$previous" ] && echo "# Previous (now dead): $previous"
    } >"$URL_FILE"
    say "PUBLIC URL: $url"
    [ -n "$previous" ] && say "  (changed — the previous link is dead)"
  fi
}

current_tunnel_url() {
  grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG_DIR/tunnel.log" 2>/dev/null | head -1
}

cleanup() {
  say "stopping"
  pkill -f "cloudflared tunnel --url http://localhost:$NEXT_PORT" 2>/dev/null
  exit 0
}
trap cleanup INT TERM

alive "$WORKER_PORT" /health || start_worker
alive "$NEXT_PORT" / || start_next
sleep 12
start_tunnel

say "supervising — Ctrl-C to stop. URL is always in PUBLIC_URL.txt"

while true; do
  sleep 20

  alive "$WORKER_PORT" /health || { say "worker down"; start_worker; sleep 8; }
  alive "$NEXT_PORT" /        || { say "next down";   start_next;   sleep 10; }

  url=$(current_tunnel_url)
  if [ -z "$url" ] || ! pgrep -f "cloudflared tunnel --url http://localhost:$NEXT_PORT" >/dev/null; then
    say "tunnel down"
    start_tunnel
    continue
  fi

  # Reaching the app THROUGH the tunnel is the only check that means anything —
  # the process can be alive while the route is broken.
  if ! curl -sf -o /dev/null --max-time 20 "$url/"; then
    say "tunnel unreachable from outside; replacing it"
    pkill -f "cloudflared tunnel --url http://localhost:$NEXT_PORT" 2>/dev/null
    sleep 2
    start_tunnel
  else
    publish "$url"
  fi
done
