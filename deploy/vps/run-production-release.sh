#!/usr/bin/env bash
set -euo pipefail
exec bash /opt/bhome-deploy/production/run-release.sh production "$@"
