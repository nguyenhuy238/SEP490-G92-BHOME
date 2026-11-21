#!/usr/bin/env python3
"""Staging-only synthetic login/refresh/logout; never print passwords or tokens."""
import http.cookiejar
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path


def main():
    fixture = dict(line.split('=', 1) for line in Path('/opt/bhome-config/sepay-staging.seed.env').read_text().splitlines() if '=' in line and not line.startswith('#'))
    cookies = http.cookiejar.CookieJar()
    client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cookies))
    origin = 'https://api-staging.103.146.23.157.sslip.io'

    def request(path, data=None, token=None):
        headers = {'Content-Type': 'application/json', 'Origin': 'https://owner-staging.103.146.23.157.sslip.io', 'X-BHome-Client': 'web'}
        if token:
            headers['Authorization'] = 'Bearer ' + token
        req = urllib.request.Request(origin + '/api/v1/' + path, data=json.dumps(data).encode() if data is not None else None, headers=headers)
        with client.open(req, timeout=20) as response:
            return response.status, json.load(response) if response.status != 204 else None

    _, login = request('auth/login', {'email': 'owner.sepay.test@example.invalid', 'password': fixture['BHOME_SEPAY_FIXTURE_PASSWORD']})
    token = login['accessToken']
    before = next(c.value for c in cookies if c.name == '__Secure-bhome-refresh')
    _, refreshed = request('auth/refresh', {})
    after = next(c.value for c in cookies if c.name == '__Secure-bhome-refresh')
    if before == after:
        raise ValueError('Refresh cookie did not rotate')
    token = refreshed['accessToken']
    status, _ = request('auth/me', token=token)
    if status != 200 or request('auth/logout', {}, token)[0] != 204:
        raise ValueError('Synthetic session check failed')
    try:
        request('auth/refresh', {})
    except urllib.error.HTTPError as error:
        if error.code != 401:
            raise
    else:
        raise ValueError('Logged-out refresh session was accepted')
    print('PASS: synthetic Staging login, refresh rotation, authorized read and logout')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(str(error) if isinstance(error, ValueError) else 'Auth smoke failed: ' + type(error).__name__, file=sys.stderr)
        sys.exit(1)
