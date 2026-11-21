#!/usr/bin/env bash
# Install ONLY on a dedicated Production CI key after environment reviewers are verified.
set -euo pipefail
pattern='^/opt/bhome-deploy/production/run-production-release\.sh ([0-9a-f]{40}) ([0-9]+-[0-9]+) (sha256:[0-9a-f]{64}) (sha256:[0-9a-f]{64}) (sha256:[0-9a-f]{64})$'
if [[ "${SSH_ORIGINAL_COMMAND:-}" =~ $pattern ]]; then
  exec bash /opt/bhome-deploy/production/run-production-release.sh "${BASH_REMATCH[@]:1}"
fi
echo 'This key only permits the reviewed Production release command.' >&2
exit 126
