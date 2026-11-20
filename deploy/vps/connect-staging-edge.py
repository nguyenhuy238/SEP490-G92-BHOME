#!/usr/bin/env python3
"""Attach unique aliases without Compose's implicit api/owner-web/public-web aliases.

Caddy also sees Production's network. Shared service aliases would route requests
to a random environment. Compose creates apps on private backend/frontend networks;
only these explicit Docker endpoints join the shared Staging edge.
"""
import json
import subprocess

NETWORK = 'bhome-staging-edge'
APPS = {
    'bhome-sepay-api-stage': 'bhome-stage-api',
    'bhome-sepay-owner-web-stage': 'bhome-owner-stage',
    'bhome-sepay-stage-public': 'bhome-public-stage',
    'bhome-staging-owner-legacy': 'bhome-owner-legacy',
    'bhome-staging-public-legacy': 'bhome-public-legacy',
}
RESERVED = {'api', 'owner-web', 'public-web', 'postgres', 'minio', 'stage-minio'}


def main():
    for container, alias in APPS.items():
        info = json.loads(subprocess.check_output(['docker', 'inspect', container]))[0]
        endpoint = info['NetworkSettings']['Networks'].get(NETWORK)
        if endpoint and (RESERVED.intersection(endpoint.get('Aliases') or []) or alias not in (endpoint.get('Aliases') or [])):
            subprocess.run(['docker', 'network', 'disconnect', NETWORK, container], check=True)
            endpoint = None
        if not endpoint:
            subprocess.run(['docker', 'network', 'connect', '--alias', alias, NETWORK, container], check=True)
        info = json.loads(subprocess.check_output(['docker', 'inspect', container]))[0]
        aliases = set(info['NetworkSettings']['Networks'][NETWORK].get('Aliases') or [])
        if RESERVED.intersection(aliases) or alias not in aliases:
            raise ValueError('Unsafe cross-environment Docker DNS alias')
    edge = json.loads(subprocess.check_output(['docker', 'network', 'inspect', NETWORK]))[0]
    if {value['Name'] for value in edge['Containers'].values()} != set(APPS) | {'bhome-vps-caddy-1'}:
        raise ValueError('Unexpected service on the Staging edge network')
    print('PASS: unique Staging edge aliases; no database/storage or Production DNS collisions')


if __name__ == '__main__':
    main()
