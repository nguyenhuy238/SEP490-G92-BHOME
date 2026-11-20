#!/usr/bin/env bash
set -euo pipefail
exec bash /opt/bhome-deploy/staging/smoke-release.sh staging "$@"
