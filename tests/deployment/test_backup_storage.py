import importlib.util
import json
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('backup_storage', Path(__file__).resolve().parents[2] / 'deploy/vps/backup-storage.py')
backup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup)


class BackupStorageTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.parent = Path(self.directory.name).resolve()
        self.root = self.parent / 'release'
        self.root.mkdir(mode=0o700)
        self.api = {'Config': {'Env': [
            'ObjectStorage__AccessKey=synthetic-access',
            'ObjectStorage__SecretKey=synthetic-secret',
            'ObjectStorage__Bucket=synthetic-private',
        ]}}
        self.storage = {'NetworkSettings': {'Networks': {'bhome-vps_default': {'IPAddress': '192.0.2.10'}}}}

    def run_backup(self, difference=b'', mirror_error=None, directory=None):
        def mirror(*args, **kwargs):
            # A real empty bucket has no object whose download could create this
            # directory. Assert the actual filesystem precondition at the CLI call.
            self.assertTrue((self.root / 'storage').is_dir())
            if mirror_error:
                raise mirror_error
            return subprocess.CompletedProcess(args[0], 0)

        with patch.object(backup, 'BACKUP_ROOT', self.parent), \
                patch.object(sys, 'argv', ['backup-storage.py', 'production', str(directory or self.root)]), \
                patch.object(backup.subprocess, 'check_output', side_effect=[json.dumps([self.api]).encode(), json.dumps([self.storage]).encode(), difference]), \
                patch.object(backup.subprocess, 'run', side_effect=mirror) as run:
            backup.main()
            return run

    def test_empty_bucket_has_local_destination_before_mirror_and_diff(self):
        run = self.run_backup()
        self.assertEqual(run.call_args.args[0][-3:], ['mirror', 'backup/synthetic-private', str(self.root / 'storage')])
        self.assertEqual(list((self.root / 'storage').iterdir()), [])
        if sys.platform != 'win32':
            self.assertEqual(stat.S_IMODE((self.root / 'storage').stat().st_mode), 0o700)
            self.assertEqual(stat.S_IMODE((self.root / 'storage-client/config.json').stat().st_mode), 0o600)

    def test_mirror_failure_is_not_reported_as_a_successful_empty_backup(self):
        with self.assertRaises(subprocess.CalledProcessError):
            self.run_backup(mirror_error=subprocess.CalledProcessError(1, 'mc'))

    def test_changed_source_is_rejected_after_mirror(self):
        with self.assertRaisesRegex(ValueError, 'Storage changed during backup'):
            self.run_backup(difference=b'synthetic difference')

    def test_destination_outside_private_backup_root_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'Unexpected backup directory'):
            self.run_backup(directory=self.parent / 'outside' / 'release')


if __name__ == '__main__':
    unittest.main()
