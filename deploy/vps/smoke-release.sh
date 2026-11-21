#!/usr/bin/env bash
set -euo pipefail
target=${1:-}; sha=${2:-}
case "$target" in
  staging) owner=https://owner-staging.103.146.23.157.sslip.io; public=https://public-staging.103.146.23.157.sslip.io; api=https://api-staging.103.146.23.157.sslip.io; other=https://owner.103.146.23.157.sslip.io ;;
  production) owner=https://owner.103.146.23.157.sslip.io; public=https://www.103.146.23.157.sslip.io; api=https://api.103.146.23.157.sslip.io; other=https://owner-staging.103.146.23.157.sslip.io ;;
  *) exit 2 ;;
esac
check() {
  local expected=$1 url=$2 actual
  actual=$(curl --max-time 20 -sS -o /dev/null -w '%{http_code}' "$url")
  test "$actual" = "$expected" || { echo "FAIL: $url HTTP $actual expected $expected" >&2; return 1; }
  echo "PASS: $url HTTP $actual TLS verified"
}
check 200 "$owner/login"
check 200 "$public/locations"
check 200 "$api/api/v1/public/locations"
check 401 "$api/api/v1/auth/me"
check 401 "$owner/api/v1/auth/me"
check 404 "$api/health/ready"
check 404 "$api/api/v1/public/rooms/00000000-0000-0000-0000-000000000000"
check 200 https://owner.103.146.23.157.sslip.io/login
check 200 https://www.103.146.23.157.sslip.io
for host in "$owner" "$public"; do
  actual=$(curl --max-time 20 -sS -o /dev/null -w '%{http_code}' "$host/api/not-a-route")
  test "$actual" != 200 || { echo "FAIL: $host/api/not-a-route returned HTML fallback HTTP 200" >&2; exit 1; }
done
headers=$(mktemp)
trap 'rm -f "$headers"' EXIT
curl --max-time 20 -sS -o /dev/null -D "$headers" -X OPTIONS -H "Origin: $owner" -H 'Access-Control-Request-Method: POST' -H 'Access-Control-Request-Headers: content-type' "$api/api/v1/auth/refresh"
tr -d '\r' < "$headers" | grep -iqx "access-control-allow-origin: $owner"
curl --max-time 20 -sS -o /dev/null -D "$headers" -X OPTIONS -H "Origin: $other" -H 'Access-Control-Request-Method: POST' "$api/api/v1/auth/refresh"
if grep -iq '^access-control-allow-origin:' "$headers"; then echo 'Cross-environment CORS was allowed.' >&2; exit 1; fi
webhook_policy=$(python3 "$(dirname "$0")/release-safety.py" webhook-policy "$target")
read -r expected_webhook expected_code <<< "$webhook_policy"
actual_webhook=$(curl --max-time 20 -sS -o "$headers" -w '%{http_code}' -X POST -H 'Content-Type: application/json' --data '{}' "$api/api/v1/integrations/sepay/webhook")
test "$actual_webhook" = "$expected_webhook" || { echo "FAIL: unsigned webhook HTTP $actual_webhook expected $expected_webhook" >&2; exit 1; }
python3 - "$headers" "$expected_code" <<'PY'
import json,sys
assert json.load(open(sys.argv[1])).get('code') == sys.argv[2], 'Webhook rejection did not match the configured integration state'
PY
echo "PASS: configured SePay webhook rejection HTTP $actual_webhook code=$expected_code"
if [ -n "$sha" ]; then
  for host in "$owner" "$public"; do
    curl --max-time 20 -fsS "$host/bhome-release.json" | python3 -c 'import json,sys; assert json.load(sys.stdin)["revision"]==sys.argv[1]' "$sha"
  done
fi
echo 'PASS: HTTPS, public API, auth isolation, CORS and unsigned webhook rejection'
if [ "$target" = staging ]; then python3 "$(dirname "$0")/smoke-auth.py"; fi
