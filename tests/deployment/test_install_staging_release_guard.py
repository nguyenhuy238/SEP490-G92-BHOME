import importlib.util
import os
import stat
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('installer', ROOT / 'deploy/vps/install-staging-release-guard.py')
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


@unittest.skipUnless(os.name == 'posix' and os.geteuid() == 0, 'Root-only Linux installation fixture')
class GuardInstallationTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
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

    def test_installs_exact_reviewed_bytes_and_retains_private_backup(self):
        with patch.object(installer, 'guard_check') as check:
            self.install()
            self.assertEqual(self.installed.read_bytes(), self.new)
            self.assertEqual(stat.S_IMODE(self.installed.stat().st_mode), 0o750)
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
        with patch.object(installer, 'guard_check',
                          side_effect=[None, None, None, ValueError('drift'), None]):
            with self.assertRaisesRegex(ValueError, 'drift'):
                self.install()
        self.assertEqual(self.installed.read_bytes(), self.old)
        self.assertEqual(stat.S_IMODE(self.installed.stat().st_mode), 0o750)

    def test_failure_after_atomic_rename_restores_old_guard(self):
        original = installer.atomic_write

        def write(path, content, mode):
            original(path, content, mode)
            if path == self.installed and content == self.new:
                raise OSError('simulated directory sync failure')

        with patch.object(installer, 'guard_check'), patch.object(installer, 'atomic_write', side_effect=write):
            with self.assertRaises(OSError):
                self.install()
        self.assertEqual(self.installed.read_bytes(), self.old)

    def test_refuses_symlink_and_writable_installed_guard(self):
        self.installed.chmod(0o777)
        with self.assertRaises(ValueError):
            installer.verify(self.root, self.before)
        self.installed.unlink()
        self.installed.symlink_to(self.candidate)
        with self.assertRaises(ValueError):
            installer.verify(self.root, self.after)

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


if __name__ == '__main__':
    unittest.main()
