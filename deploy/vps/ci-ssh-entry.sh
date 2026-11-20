#!/usr/bin/env bash
# Install as a forced command on the dedicated CI public key, never the operator key.
set -euo pipefail
pattern='^/opt/bhome-deploy/staging/run-staging-release\.sh ([0-9a-f]{40}) ([0-9]+-[0-9]+) (sha256:[0-9a-f]{64}) (sha256:[0-9a-f]{64}) (sha256:[0-9a-f]{64})$'
if [[ "${SSH_ORIGINAL_COMMAND:-}" =~ $pattern ]]; then
  exec bash /opt/bhome-deploy/staging/run-staging-release.sh "${BASH_REMATCH[@]:1}"
fi
echo 'This key only permits the reviewed Staging release command.' >&2
exit 126
