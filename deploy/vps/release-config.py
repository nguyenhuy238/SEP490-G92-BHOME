#!/usr/bin/env python3
"""Keep private runtime settings independent of replaceable release images."""
import copy
import json
import os
import subprocess
import sys
from pathlib import Path


def bootstrap_staging_runtime(path, environment):
    path = Path(path)
    if path.exists():
        return False  # Operator-owned settings are never replaced by a release.
    if any(environment.get(key) != 'Staging' for key in
           ('ASPNETCORE_ENVIRONMENT', 'DOTNET_ENVIRONMENT', 'Deployment__Environment')):
        raise ValueError('Cannot preserve runtime settings from a non-Staging API')
    manual = environment.get('BillingAutomation__ManualActionsEnabled', 'false').lower()
    if manual not in ('true', 'false'):
        raise ValueError('Invalid Staging manual billing setting')
    value = {'services': {'api': {'environment': {'BillingAutomation__ManualActionsEnabled': manual}}}}
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, 'w') as stream:
        json.dump(value, stream, indent=2)
        stream.write('\n')
    return True


def check_image_only_transition(before, after, images):
    original, candidate = copy.deepcopy(before), copy.deepcopy(after)
    if set(images) != {'api', 'owner-web', 'public-web'}:
        raise ValueError('Release must identify exactly the three application images')
    for service, image in images.items():
        if service not in original.get('services', {}) or service not in candidate.get('services', {}):
            raise ValueError('Application service missing from release configuration')
        if candidate['services'][service].get('image') != image:
            raise ValueError('Candidate image does not match the verified release')
        original['services'][service].pop('image', None)
        candidate['services'][service].pop('image', None)
    if original != candidate:
        raise ValueError('Release changes runtime configuration; preserve it in a private overlay first')


def main():
    command, *args = sys.argv[1:]
    if command == 'bootstrap-staging' and len(args) == 1:
        path = Path(args[0])
        if not path.exists():
            raw = subprocess.check_output(['docker', 'inspect', 'bhome-sepay-api-stage'],
                                          text=True, stderr=subprocess.DEVNULL)
            environment = dict(value.split('=', 1) for value in json.loads(raw)[0]['Config']['Env'] if '=' in value)
            bootstrap_staging_runtime(path, environment)
        print('PASS: persistent Staging runtime overlay retained')
    elif command == 'check' and len(args) == 5:
        before, after, api, owner, public = args
        check_image_only_transition(json.loads(Path(before).read_text()), json.loads(Path(after).read_text()),
                                    {'api': api, 'owner-web': owner, 'public-web': public})
        print('PASS: only application images change; private runtime configuration retained')
    else:
        raise ValueError('Invalid release configuration command')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, subprocess.SubprocessError):
        print('Release configuration check failed; private settings must remain unchanged.', file=sys.stderr)
        sys.exit(1)
