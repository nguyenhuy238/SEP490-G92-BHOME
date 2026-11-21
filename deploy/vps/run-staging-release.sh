#!/usr/bin/env bash
set -euo pipefail
exec bash /opt/bhome-deploy/staging/run-release.sh staging "$@"
