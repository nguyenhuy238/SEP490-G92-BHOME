import importlib.util
import json
import os
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import test_release_safety as safety_tests

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('installer', ROOT / 'deploy/vps/install-staging-release-guard.py')
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


@unittest.skipUnless(os.name == 'posix', 'Linux installation fixture')
class GuardInstallationTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        # Only substitute the trusted UID in this isolated fixture. The CLI
        # still requires root, and real mode checks, ownership and flock run.
        uid = patch.object(installer, 'ROOT_UID', os.geteuid())
        uid.start()
        self.addCleanup(uid.stop)
        self.installed = self.root / 'release-safety.py'
        self.candidate = self.root / 'candidate.py'
        self.old = b'print("old")\n'
        self.new = b'print("new")\n'
        self.installed.write_bytes(self.old)
        self.installed.chmod(0o750)
        self.candidate.write_bytes(self.new)
        self.before = installer.digest(self.old)
        self.after = installer.digest(self.new)

    def install(self):
        installer.install(self.root, self.candidate, self.before, self.after)

    def fake_check(self, path, command, *args):
        if command == 'snapshot':
            args[0].write_text('{}')
            args[0].chmod(0o600)

    def test_installs_exact_reviewed_bytes_and_retains_private_backup(self):
        if os.geteuid() == 0:
            os.chown(self.installed, 0, 12345)
        before = self.installed.stat()
        with patch.object(installer, 'guard_check', side_effect=self.fake_check) as check:
            self.install()
            self.assertEqual(self.installed.read_bytes(), self.new)
            self.assertEqual(stat.S_IMODE(self.installed.stat().st_mode), 0o750)
            self.assertEqual((self.installed.stat().st_uid, self.installed.stat().st_gid),
                             (before.st_uid, before.st_gid))
            backup, = self.root.glob('guard-rollout-*')
            self.assertEqual(stat.S_IMODE(backup.stat().st_mode), 0o700)
            self.assertEqual((backup / 'release-safety.before.py').read_bytes(), self.old)
            self.assertEqual([call.args[1] for call in check.call_args_list],
                             ['check', 'snapshot', 'check', 'unchanged'])
            self.assertEqual(check.call_args_list[-1].args[0], self.installed)
            installer.verify(self.root, self.after)

    def test_wrong_old_or_candidate_hash_cannot_replace_guard(self):
        for old, new in (('0' * 64, self.after), (self.before, '0' * 64)):
            with patch.object(installer, 'guard_check'), self.assertRaises(ValueError):
                installer.install(self.root, self.candidate, old, new)
            self.assertEqual(self.installed.read_bytes(), self.old)
            self.assertEqual(list(self.root.glob('guard-rollout-*')), [])

    def test_failed_candidate_snapshot_leaves_installed_guard_untouched(self):
        with patch.object(installer, 'guard_check', side_effect=[None, ValueError('snapshot')]):
            with self.assertRaisesRegex(ValueError, 'snapshot'):
                self.install()
        self.assertEqual(self.installed.read_bytes(), self.old)

    def test_post_install_failure_restores_old_guard(self):
        def check(path, command, *args):
            if command == 'unchanged':
                raise ValueError('drift')
            self.fake_check(path, command, *args)
        before = self.installed.stat()
        with patch.object(installer, 'guard_check', side_effect=check):
            with self.assertRaisesRegex(ValueError, 'drift'):
                self.install()
        self.assertEqual(self.installed.read_bytes(), self.old)
        self.assertEqual(stat.S_IMODE(self.installed.stat().st_mode), 0o750)
        self.assertEqual((self.installed.stat().st_uid, self.installed.stat().st_gid),
                         (before.st_uid, before.st_gid))

    def test_failure_after_atomic_rename_restores_old_guard(self):
        original = installer.atomic_write

        def write(path, content, mode, owner=None):
            original(path, content, mode, owner)
            if path == self.installed and content == self.new:
                raise OSError('simulated directory sync failure')

        with patch.object(installer, 'guard_check', side_effect=self.fake_check), patch.object(installer, 'atomic_write', side_effect=write):
            with self.assertRaises(OSError):
                self.install()
        self.assertEqual(self.installed.read_bytes(), self.old)

    def test_nonroot_cli_refuses_before_accessing_live_paths(self):
        with patch.object(installer.os, 'geteuid', return_value=1000), \
                patch.object(sys, 'argv', ['installer', 'verify', self.before]), \
                patch.object(installer, 'trusted') as trusted:
            with self.assertRaisesRegex(ValueError, 'Root operator approval'):
                installer.main()
            trusted.assert_not_called()
        if os.geteuid() != 0:
            result = subprocess.run(
                [sys.executable, '-I', str(ROOT / 'deploy/vps/install-staging-release-guard.py'),
                 'verify', self.before], capture_output=True, text=True, timeout=10)
            self.assertEqual(result.returncode, 1)
            self.assertIn('Root operator approval is required', result.stderr)

    def test_snapshot_recovery_requires_reviewed_hash_and_unchanged_state(self):
        with patch.object(installer, 'guard_check', side_effect=self.fake_check):
            self.install()
        backup, = self.root.glob('guard-rollout-*')
        snapshot = backup / 'protected.json'
        with patch.object(installer, 'guard_check', side_effect=self.fake_check) as check:
            installer.verify(self.root, self.after, snapshot)
            self.assertEqual(check.call_args_list[-1].args, (self.installed, 'unchanged', snapshot))
            with self.assertRaisesRegex(ValueError, 'SHA-256 mismatch'):
                installer.verify(self.root, self.before, snapshot)
        with patch.object(installer, 'guard_check', side_effect=[None, ValueError('drift')]):
            with self.assertRaisesRegex(ValueError, 'drift'):
                installer.verify(self.root, self.after, snapshot)
        snapshot.unlink()
        with patch.object(installer, 'guard_check'), self.assertRaises(FileNotFoundError):
            installer.verify(self.root, self.after, snapshot)

    def test_refuses_symlink_and_writable_installed_guard(self):
        self.installed.chmod(0o777)
        with self.assertRaises(ValueError):
            installer.verify(self.root, self.before)
        self.installed.unlink()
        self.installed.symlink_to(self.candidate)
        with self.assertRaises(ValueError):
            installer.verify(self.root, self.after)

    def test_refuses_unsafe_candidate_and_lock(self):
        link = self.root / 'candidate-link.py'
        link.symlink_to(self.candidate)
        with patch.object(installer, 'guard_check'):
            with self.assertRaises(ValueError):
                installer.install(self.root, link, self.before, self.after)
            self.candidate.chmod(0o666)
            with self.assertRaises(ValueError):
                self.install()
        lock = self.root / 'lock'
        lock.symlink_to(self.installed)
        with patch.object(installer, 'LOCKS', (lock,)), self.assertRaises(OSError):
            with installer.release_locks():
                self.fail('Symlink lock accepted')
        lock.unlink()
        lock.touch()
        lock.chmod(0o666)
        with patch.object(installer, 'LOCKS', (lock,)), self.assertRaises(ValueError):
            with installer.release_locks():
                self.fail('Writable lock accepted')
        self.assertEqual(self.installed.read_bytes(), self.old)
        self.assertEqual(list(self.root.glob('guard-rollout-*')), [])

    def test_lock_contention_blocks_update(self):
        locks = (self.root / 'shared.lock', self.root / 'staging.lock')
        with patch.object(installer, 'LOCKS', locks):
            with installer.release_locks():
                with self.assertRaises(BlockingIOError):
                    with installer.release_locks():
                        self.fail('Concurrent update must not acquire locks')
        self.assertEqual(self.installed.read_bytes(), self.old)

    def test_release_worker_uses_installed_guard_and_ci_cannot_call_installer(self):
        deploy = (ROOT / 'deploy/vps/deploy-release.sh').read_text()
        forced = (ROOT / 'deploy/vps/ci-ssh-entry.sh').read_text()
        workflow = (ROOT / '.github/workflows/release.yml').read_text()
        self.assertIn('root=/opt/bhome-deploy/$target', deploy)
        self.assertIn('python3 "$root/release-safety.py" snapshot', deploy)
        self.assertIn('python3 "$root/release-safety.py" unchanged', deploy)
        self.assertNotIn('install-staging-release-guard', forced + workflow)
        self.assertIn('/opt/bhome-deploy/staging/run-staging-release.sh', workflow)
        self.assertIn('exit 126', forced)

    def test_installed_real_guard_and_worker_rollback(self):
        # All Docker responses and release mutations are confined to this fixture.
        fixture = safety_tests.ReleaseSafetyTests()
        stage = fixture.configuration('staging')
        prod = fixture.configuration('production')
        state = self.root / 'state.json'
        state.write_text(json.dumps(stage))
        docker = self.root / 'docker'
        docker.write_text('#!' + sys.executable + '\n' +
            'import json, sys\nfrom pathlib import Path\n' +
            'assert sys.argv[1] == "inspect"\nname = sys.argv[2]\n' +
            'stage = json.loads(Path(' + repr(str(state)) + ').read_text())\n' +
            'prod = ' + repr(prod) + '\n' +
            'env = stage if name == "bhome-sepay-api-stage" else prod\n' +
            'print(json.dumps([dict(Id=name, Image="synthetic", Mounts=[], '
            'State=dict(StartedAt="fixed"), Config=dict(Env=[k+"="+v for k,v in env.items()]))]))\n')
        docker.chmod(0o700)
        self.candidate.write_bytes((ROOT / 'deploy/vps/release-safety.py').read_bytes())
        approved = installer.digest(self.candidate.read_bytes())
        # Reuse the actual worker's EXIT trap, not a reimplementation.
        deploy = (ROOT / 'deploy/vps/deploy-release.sh').read_text()
        trap = deploy[deploy.index('rollback() {'):deploy.index('connect_edge() {')]
        (self.root / 'smoke-release.sh').write_text('exit 0\n')
        release = self.root / 'release.yml'
        (self.root / 'release.before.yml').write_text('old\n')
        environment = dict(os.environ, PATH=str(self.root) + os.pathsep + os.environ['PATH'])
        with patch.dict(os.environ, environment):
            # Force an abrupt process exit after the durable rename, without
            # running the exception handler. Recovery is an operator action.
            original = installer.atomic_write
            def interrupted_write(path, content, mode, owner=None):
                original(path, content, mode, owner)
                if path == self.installed:
                    os._exit(73)
            pid = os.fork()
            if pid == 0:
                with patch.object(installer, 'atomic_write', side_effect=interrupted_write):
                    installer.install(self.root, self.candidate, self.before, approved)
                os._exit(74)
            _, status = os.waitpid(pid, 0)
            self.assertEqual(os.waitstatus_to_exitcode(status), 73)
            backup, = self.root.glob('guard-rollout-*')
            self.assertEqual((backup / 'release-safety.before.py').read_bytes(), self.old)
            self.assertEqual((backup / 'release-safety.candidate.py').read_bytes(), self.candidate.read_bytes())
            installer.verify(self.root, approved, backup / 'protected.json')
            state.write_text(json.dumps(stage | {'Ocr__Enabled': 'false'}))
            with self.assertRaisesRegex(ValueError, 'rejected unchanged'):
                installer.verify(self.root, approved, backup / 'protected.json')
            state.write_text(json.dumps(stage))
            self.assertEqual(self.installed.read_bytes(), self.candidate.read_bytes())
            installer.guard_check(self.installed, 'snapshot', self.root / 'protected.json')
            for override, expected in (({}, 0), ({'Ocr__Enabled': 'false'}, 1),
                                       ({'Jwt__SigningKey': 'synthetic-drift'}, 1)):
                with self.subTest(override=override):
                    state.write_text(json.dumps(stage))
                    release.write_text('new\n')
                    changed = stage | safety_tests.safety.RELEASE_OCR_DEFAULTS | override
                    state.write_text(json.dumps(changed))
                    script = '''set -euo pipefail
root=$1; run=$1; target=staging; release="$root/release.yml"; changed=true
dc() { if [ "$1" = up ]; then cp "$root/old-state.json" "$root/state.json"; fi; }
connect_edge() { :; }
ready() { :; }
''' + trap + '''
python3 "$root/release-safety.py" unchanged "$target" "$run/protected.json"
echo DEPLOY_PASS
'''
                    (self.root / 'old-state.json').write_text(json.dumps(stage))
                    result = subprocess.run(['bash', '-c', script, 'fixture', str(self.root)],
                                            env=environment, capture_output=True, text=True, timeout=30)
                    self.assertEqual(result.returncode, expected, result.stdout + result.stderr)
                    self.assertIn('PASS: unchanged staging', result.stdout)
                    self.assertIn('ROLLBACK_PASS' if expected else 'DEPLOY_PASS', result.stdout)
                    self.assertEqual(release.read_text(), 'old\n' if expected else 'new\n')


if __name__ == '__main__':
    unittest.main()
