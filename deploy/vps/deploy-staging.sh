#!/usr/bin/env bash
set -euo pipefail
exec bash /opt/bhome-deploy/staging/deploy-release.sh staging "$@"
