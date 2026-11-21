#!/usr/bin/env bash
# Root-owned application-only deployment. No schema changes, seed, database or storage recreation.
set -euo pipefail
umask 077
target=${1:-}; sha=${2:-}; run_id=${3:-}; api_digest=${4:-}; owner_digest=${5:-}; public_digest=${6:-}
[[ "$target" =~ ^(staging|production)$ && "$sha" =~ ^[0-9a-f]{40}$ && "$run_id" =~ ^[0-9]+-[0-9]+$ ]] || exit 2
for digest in "$api_digest" "$owner_digest" "$public_digest"; do [[ "$digest" =~ ^sha256:[0-9a-f]{64}$ ]] || exit 2; done
root=/opt/bhome-deploy/$target
config=/opt/bhome-config
# Each release verifies the other environment stayed unchanged. Serialize both
# environments on this VPS so an approved parallel release cannot trip that guard.
exec 8>/run/lock/bhome-vps-application-release.lock
flock -w 900 8 || { echo 'Shared VPS application release lock timed out.' >&2; exit 3; }
exec 9>"/run/lock/bhome-$target-cd.lock"
flock -w 900 9 || { echo 'Deployment lock timed out.' >&2; exit 3; }
branch=develop; project=bhome-sepay-stage; api_container=bhome-sepay-api-stage; pg=bhome-sepay-vps-stage; suffix=
if [ "$target" = production ]; then
  branch=main; project=bhome-vps; api_container=bhome-vps-api-1; pg=bhome-vps-postgres-1; suffix=-production
  # Only an operator installs this file after reviewing the first Production release.
  test -f "$root/ENABLED_AFTER_REVIEW" || { echo 'Production procedure has not been commissioned.' >&2; exit 4; }
fi
latest() {
  test "$(git -C /opt/bhome ls-remote origin "refs/heads/$branch" | cut -f1)" = "$sha" || { echo 'Refusing a stale or non-branch release.' >&2; return 1; }
}
latest
if [ -f "$root/current.json" ]; then
  python3 - "$root/current.json" "$run_id" <<'PY'
import json,sys
current=json.load(open(sys.argv[1])); incoming=tuple(map(int,sys.argv[2].split('-')))
assert incoming > tuple(map(int,current['run'].split('-'))), 'Refusing an older or repeated release; resume its existing worker instead.'
PY
fi
# Bootstrap the private backup parent before allocating per-release evidence.
mkdir -p -m 700 /opt/bhome-backups
run=$(mktemp -d "/opt/bhome-backups/$target-cd-$(date -u +%Y%m%dT%H%M%S)-${sha:0:12}-XXXX")
exec > >(tee -a "$run/deploy.log") 2>&1
echo "Release target=$target sha=$sha run=$run_id evidence=$run"
dc() {
  if [ "$target" = staging ]; then
    docker compose -p "$project" --env-file "$config/sepay-staging.db.env" --env-file "$config/stage-storage.env" \
      -f /opt/bhome/deploy/compose.sepay.yml -f "$config/compose.sepay-stage-api.yml" \
      -f "$config/compose.sepay-stage-web.yml" -f "$config/compose.sepay-stage-public.yml" -f "$config/compose.staging-compat.yml" -f "$config/compose.sepay-stage-release.yml" "$@"
  else
    docker compose -p "$project" --env-file "$config/stack.env" -f /opt/bhome/docker-compose.yml \
      -f "$config/compose.vps.yml" -f "$config/compose.integrations.yml" -f "$config/compose.production-environment.yml" -f "$config/compose.production-release.yml" "$@"
  fi
}
release="$config/compose.sepay-stage-release.yml"
if [ "$target" = production ]; then release="$config/compose.production-release.yml"; fi
test -s "$release"
python3 "$root/release-safety.py" snapshot "$target" "$run/protected.json"
cp -p "$release" "$run/release.before.yml"
tar --exclude=bhome-config/backups --exclude=bhome-config/quarantine-git-paste-20261120 -czf "$run/private-config.tar.gz" -C /opt bhome-config
dc config --quiet
test "$(df --output=avail -B1 /opt | tail -1)" -gt 4294967296
# A reviewed schema baseline prevents silently deploying a schema-changing release.
git -C /opt/bhome fetch --quiet origin "$sha"
git -C /opt/bhome show "$sha:docs/database/2026-11-03/compact-24/BHOME_24_TABLES.sql" | sha256sum | cut -d' ' -f1 > "$run/schema.sha256"
cmp "$root/schema-baseline.sha256" "$run/schema.sha256" || { echo 'Schema artifact changed; a separate migration review is required.' >&2; exit 5; }
# Use the container's existing PostgreSQL identity without exposing its password.
docker exec "$pg" sh -c 'pg_dump -U "$POSTGRES_USER" -d "$1" -Fc' sh "$([ "$target" = staging ] && echo bhome_compact24_dev_f723d9c0ff6acd3c4cce870df1e72989 || echo bhome)" > "$run/database.dump"
docker exec -i "$pg" pg_restore --list < "$run/database.dump" > "$run/database.list"
verify="bhome_cd_verify_${run_id//-/_}_$(date -u +%H%M%S)"
docker exec "$pg" sh -c 'createdb -U "$POSTGRES_USER" "$1"' sh "$verify"
docker exec -i "$pg" sh -c 'pg_restore -U "$POSTGRES_USER" -d "$1" --exit-on-error' sh "$verify" < "$run/database.dump"
echo "PASS: backup restored into a separate verification database $verify"
python3 "$root/backup-storage.py" "$target" "$run"
api="ghcr.io/nguyenhuy238/bhome-api:sha-$sha@$api_digest"
owner="ghcr.io/nguyenhuy238/bhome-owner-web$suffix:sha-$sha@$owner_digest"
public="ghcr.io/nguyenhuy238/bhome-public-web$suffix:sha-$sha@$public_digest"
for pair in "api $api" "owner-web $owner" "public-web $public"; do
  read -r app image <<< "$pair"
  docker pull "$image"
  python3 "$root/release-safety.py" verify-image "$target" "$image" "$sha" "$app"
done
cat > "$run/release.next.yml" <<YAML
services:
  api:
    image: $api
  owner-web:
    image: $owner
    volumes: !reset []
  public-web:
    image: $public
YAML
ready() {
  for attempt in $(seq 1 60); do
    if docker run --rm --network "container:$api_container" --entrypoint curl bhome/minio-local:2025-10-15 -fsS --max-time 4 http://127.0.0.1:8080/health/ready >/dev/null 2>&1; then return 0; fi
    sleep 2
  done
  return 1
}
changed=false
rollback() {
  code=$?; trap - EXIT
  if [ "$code" != 0 ] && [ "$changed" = true ]; then
    cat "$run/release.before.yml" > "$release"
    if dc config --quiet && dc up -d --no-deps --no-build --pull never api owner-web public-web && connect_edge && ready && bash "$root/smoke-release.sh" "$target"; then
      echo ROLLBACK_PASS
    else
      echo 'ROLLBACK_FAILED: operator intervention required.' >&2
    fi
  fi
  python3 "$root/release-safety.py" unchanged "$target" "$run/protected.json" || code=1
  echo "Release exit=$code evidence=$run"
  exit "$code"
}
trap rollback EXIT
connect_edge() {
  if [ "$target" = staging ]; then python3 "$root/connect-staging-edge.py"; fi
}
latest
changed=true
cat "$run/release.next.yml" > "$release"
dc config --quiet
dc up -d --no-deps --no-build --pull never api owner-web public-web
connect_edge
ready
bash "$root/smoke-release.sh" "$target" "$sha"
python3 "$root/release-safety.py" verify-running "$target" "$api" "$owner" "$public"
python3 "$root/release-safety.py" unchanged "$target" "$run/protected.json"
python3 - "$sha" "$run_id" "$api" "$owner" "$public" "$run/manifest.json" <<'PY'
import json,sys
sha,run,api,owner,public,path=sys.argv[1:]
json.dump({'sha':sha,'run':run,'images':{'api':api,'owner-web':owner,'public-web':public}},open(path,'w'),indent=2)
PY
cp "$run/manifest.json" "$root/current.json.tmp"
mv "$root/current.json.tmp" "$root/current.json"
echo DEPLOY_PASS
