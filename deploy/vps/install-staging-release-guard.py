#!/usr/bin/env python3
"""Operator-only installation of an explicitly reviewed Staging release guard."""
import argparse
import contextlib
import fcntl
import hashlib
import os
import re
import stat
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path('/opt/bhome-deploy/staging')
ROOT_UID = 0
LOCKS = (Path('/run/lock/bhome-vps-application-release.lock'),
         Path('/run/lock/bhome-staging-cd.lock'))


def digest(data):
    return hashlib.sha256(data).hexdigest()


def trusted(path, directory=False):
    info = path.lstat()
    kind = stat.S_ISDIR if directory else stat.S_ISREG
    if not kind(info.st_mode) or info.st_uid != ROOT_UID or info.st_mode & 0o022:
        raise ValueError('Unsafe ownership, type or permissions: ' + path.name)
    return info


@contextlib.contextmanager
def release_locks():
    with contextlib.ExitStack() as stack:
        for path in LOCKS:
            fd = os.open(path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
            stream = stack.enter_context(os.fdopen(fd, 'rb'))
            info = os.fstat(stream.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_uid != ROOT_UID or info.st_mode & 0o022:
                raise ValueError('Unsafe release lock')
            fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield


def sync_directory(path):
    directory = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


def atomic_write(path, content, mode, owner=None):
    fd, name = tempfile.mkstemp(prefix='.guard-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as stream:
            if owner is not None:
                os.fchown(stream.fileno(), *owner)
            os.fchmod(stream.fileno(), mode)
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, path)
        sync_directory(path.parent)
    finally:
        Path(name).unlink(missing_ok=True)


def guard_check(path, command, *args):
    result = subprocess.run([sys.executable, '-I', str(path), command, 'staging', *map(str, args)],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=60)
    if result.returncode != 0:
        raise ValueError('Staging guard rejected ' + command)


def verify(root, expected, snapshot=None):
    installed = root / 'release-safety.py'
    trusted(installed)
    if digest(installed.read_bytes()) != expected:
        raise ValueError('Installed Staging guard SHA-256 mismatch')
    guard_check(installed, 'check')
    if snapshot is not None:
        trusted(snapshot.parent, directory=True)
        trusted(snapshot)
        guard_check(installed, 'unchanged', snapshot)
    return installed


def install(root, candidate, expected_old, expected_new):
    installed = verify(root, expected_old)
    old = installed.read_bytes()
    info = trusted(installed)
    mode = stat.S_IMODE(info.st_mode)
    owner = (info.st_uid, info.st_gid)
    trusted(candidate.parent, directory=True)
    trusted(candidate)
    new = candidate.read_bytes()
    if digest(new) != expected_new or digest(old) != expected_old:
        raise ValueError('Reviewed guard SHA-256 mismatch')
    if expected_old == expected_new:
        raise ValueError('Guard already has the requested version; use verify')

    # Private, unique evidence survives interruption and never contains app secrets.
    backup = Path(tempfile.mkdtemp(prefix='guard-rollout-', dir=root))
    atomic_write(backup / 'release-safety.before.py', old, 0o600)
    atomic_write(backup / 'release-safety.candidate.py', new, 0o600)
    atomic_write(backup / 'sha256.txt',
                 (expected_old + '  before\n' + expected_new + '  candidate\n').encode(), 0o600)
    print('Guard backup: ' + str(backup), flush=True)
    staged = backup / 'release-safety.candidate.py'
    # Execute only the explicitly pinned candidate; take its own snapshot so
    # changes in fingerprint representation are not confused with runtime drift.
    guard_check(staged, 'snapshot', backup / 'protected.json')
    # Persist the pre-install evidence and its directory entry before swapping.
    snapshot = backup / 'protected.json'
    trusted(snapshot)
    snapshot.chmod(0o600)
    with snapshot.open('rb') as stream:
        os.fsync(stream.fileno())
    sync_directory(backup)
    sync_directory(root)
    try:
        atomic_write(installed, new, mode, owner)
        verify(root, expected_new, snapshot)
    except BaseException:
        # Even an error after rename (e.g. fsync failure) must restore old bytes.
        try:
            atomic_write(installed, old, mode, owner)
            verify(root, expected_old)
        except BaseException:
            raise RuntimeError('Guard rollback failed; operator intervention required') from None
        print('GUARD_ROLLBACK_PASS', flush=True)
        raise
    print('GUARD_INSTALL_PASS sha256=' + expected_new, flush=True)


def sha256(value):
    if not re.fullmatch('[0-9a-f]{64}', value):
        raise argparse.ArgumentTypeError('Expected lowercase SHA-256')
    return value


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    check = commands.add_parser('verify')
    check.add_argument('expected', type=sha256)
    check.add_argument('--snapshot', type=Path,
                       help='Also verify saved pre-install protected state after an interrupted rollout')
    update = commands.add_parser('install')
    update.add_argument('candidate', type=Path)
    update.add_argument('expected_old', type=sha256)
    update.add_argument('expected_new', type=sha256)
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise ValueError('Root operator approval is required')
    os.umask(0o077)
    for path in (ROOT.parent, ROOT):
        trusted(path, directory=True)
    with release_locks():
        if args.command == 'verify':
            verify(ROOT, args.expected, args.snapshot)
            print('GUARD_VERIFY_PASS sha256=' + args.expected)
        else:
            install(ROOT, args.candidate, args.expected_old, args.expected_new)


if __name__ == '__main__':
    try:
        main()
    except (ValueError, RuntimeError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
    except BlockingIOError:
        print('Release lock busy; no guard update performed', file=sys.stderr)
        sys.exit(1)
    except (OSError, subprocess.SubprocessError) as error:
        print('Guard operation failed: ' + type(error).__name__, file=sys.stderr)
        sys.exit(1)
