#!/usr/bin/env bash
# SSH may reconnect to the same immutable run; tmux owns the deployment lifetime.
set -euo pipefail
umask 077
worker=false
if [ "${1:-}" = --worker ]; then worker=true; shift; fi
target=${1:-}; sha=${2:-}; run_id=${3:-}; api=${4:-}; owner=${5:-}; public=${6:-}
[[ "$target" =~ ^(staging|production)$ && "$sha" =~ ^[0-9a-f]{40}$ && "$run_id" =~ ^[0-9]+-[0-9]+$ ]] || exit 2
for digest in "$api" "$owner" "$public"; do [[ "$digest" =~ ^sha256:[0-9a-f]{64}$ ]] || exit 2; done
run=/opt/bhome-deploy/runs/$target-$run_id
if [ "$worker" = true ]; then
  set +e
  bash "/opt/bhome-deploy/$target/deploy-release.sh" "$target" "$sha" "$run_id" "$api" "$owner" "$public" > "$run/output.log" 2>&1
  result=$?
  printf '%s\n' "$result" > "$run/status.tmp"
  mv "$run/status.tmp" "$run/status"
  exit "$result"
fi
mkdir -p /opt/bhome-deploy/runs
identity="$sha $api $owner $public"
if mkdir "$run" 2>/dev/null; then
  printf '%s\n' "$identity" > "$run/identity"
  tmux has-session -t bhome-deploy 2>/dev/null || tmux new-session -d -s bhome-deploy
  tmux new-window -d -t bhome-deploy -n "$target-${sha:0:8}" "bash /opt/bhome-deploy/$target/run-release.sh --worker $target $sha $run_id $api $owner $public"
else
  test "$(cat "$run/identity")" = "$identity" || { echo 'Run ID belongs to different release artifacts.' >&2; exit 4; }
fi
for attempt in $(seq 1 500); do
  if [ -f "$run/status" ]; then
    cat "$run/output.log"
    result=$(cat "$run/status")
    [[ "$result" =~ ^[0-9]+$ ]] || exit 5
    exit "$result"
  fi
  sleep 3
done
echo "Worker is still running; reconnect using the same command. Evidence: $run" >&2
exit 6
