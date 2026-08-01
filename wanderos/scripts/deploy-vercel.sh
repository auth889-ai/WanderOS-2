#!/bin/bash
#
# Deploy the Next.js app to Vercel using a TOKEN, not an interactive login.
#
#   VERCEL_TOKEN=xxx ./scripts/deploy-vercel.sh
#
# Why a token: `vercel login` opens a browser and authenticates a human. A token
# is a scoped credential you create deliberately and can revoke in one click,
# which is the right shape for automation. Create one at:
#
#   https://vercel.com/account/settings/tokens
#
# This script copies the environment this app actually reads out of .env* and
# into the Vercel project, skipping anything unset so a missing optional key
# cannot overwrite a real one with an empty string.
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
export PATH="$HOME/bin:/opt/homebrew/bin:$PATH"

: "${VERCEL_TOKEN:?Set VERCEL_TOKEN. Create one at https://vercel.com/account/settings/tokens}"

# Everything the app reads. DATABASE_URL and MEDIA_WORKER_URL must point at
# something reachable FROM VERCEL — a localhost value deploys a broken site that
# looks fine until someone opens it.
REQUIRED=(DATABASE_URL AUTH_SECRET MEDIA_WORKER_URL)
OPTIONAL=(
  B2_KEY_ID B2_APPLICATION_KEY B2_ENDPOINT B2_MEDIA_BUCKET B2_PROVENANCE_BUCKET
  AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_REGION
  FAL_KEY GEMINI_API_KEY GOOGLE_API_KEY OPENAI_API_KEY
  AVIATIONSTACK_API_KEY OPENSKY_CLIENT_ID OPENSKY_CLIENT_SECRET
  CLOUDINARY_CLOUD_NAME CLOUDINARY_KEY CLOUDINARY_SECRET
  GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET CALENDARIFIC_API_KEY
)

# Read the env files by PARSING rather than sourcing.
#
# .env.local uses `//` for comments in places — valid to Next's dotenv reader,
# but shell tries to execute it (`//: is a directory`). Sourcing also runs any
# command substitution that happens to be in a value, which is not something a
# config file should be able to do. So: match KEY=VALUE, ignore everything else.
load_env() {
  local file="$1"
  [ -f "$file" ] || return 0
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      \#*|//*|"") continue ;;
    esac
    [[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]] || continue
    local key="${BASH_REMATCH[1]}" value="${BASH_REMATCH[2]}"
    # Strip one layer of matching quotes, and a trailing inline comment.
    value="${value%\"}"; value="${value#\"}"
    value="${value%\'}"; value="${value#\'}"
    # Only set if not already set — .env.local wins over .env, as Next does.
    [ -z "${!key:-}" ] && export "$key=$value"
  done < "$file"
}

for f in .env.local .env; do load_env "$f"; done

echo "== checking what would be deployed =="
missing=()
for key in "${REQUIRED[@]}"; do
  value="${!key:-}"
  if [ -z "$value" ]; then
    missing+=("$key")
  elif [[ "$value" == *localhost* || "$value" == *127.0.0.1* ]]; then
    # This is the failure that looks like success: the build passes, the site
    # loads, and every database call times out for anyone who is not you.
    echo "  ✗ $key points at localhost — Vercel cannot reach it"
    missing+=("$key")
  else
    echo "  ✓ $key"
  fi
done

if [ ${#missing[@]} -gt 0 ]; then
  cat <<EOF

Cannot deploy yet. These must point at something reachable from the internet:

  ${missing[*]}

  DATABASE_URL      a hosted Postgres. Neon's free tier works:
                    https://neon.tech  ->  copy the connection string
  MEDIA_WORKER_URL  where the Python worker runs. Either the tunnel hostname
                    in PUBLIC_URL.txt, or a deployed worker.
  AUTH_SECRET       any long random string: openssl rand -hex 32

Nothing was deployed. A half-configured deploy is worse than none, because it
looks live.
EOF
  exit 1
fi

echo
echo "== linking project =="
npx --yes vercel@latest link --yes --token "$VERCEL_TOKEN" >/dev/null

push_env() {
  local key="$1" value="${!1:-}"
  [ -z "$value" ] && return 0
  # Replace rather than duplicate — Vercel keeps multiple values per key
  # otherwise, and the older one can win.
  npx --yes vercel@latest env rm "$key" production --yes --token "$VERCEL_TOKEN" >/dev/null 2>&1 || true
  printf '%s' "$value" | npx --yes vercel@latest env add "$key" production --token "$VERCEL_TOKEN" >/dev/null 2>&1 \
    && echo "  set $key" || echo "  ! failed $key"
}

echo
echo "== pushing environment =="
for key in "${REQUIRED[@]}" "${OPTIONAL[@]}"; do push_env "$key"; done

echo
echo "== deploying =="
URL=$(npx --yes vercel@latest deploy --prod --yes --token "$VERCEL_TOKEN" 2>&1 | tail -1)

echo
echo "========================================"
echo "  LIVE: $URL"
echo "========================================"
echo "$URL" > "$ROOT/DEPLOYED_URL.txt"

echo
echo "== verifying the deployed site actually works =="
for path in / /try /gallery; do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 30 "$URL$path" || echo 000)
  printf '  %-12s %s\n' "$path" "$code"
done
