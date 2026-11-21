import os
import shutil
import stat
import subprocess
import tempfile
import unittest
from pathlib import Path


@unittest.skipUnless(os.name == 'posix' and shutil.which('bash'), 'Requires POSIX Bash and filesystem permissions')
class ReleaseBackupDirectoryTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.backups = self.root / 'backups'
        self.sha = 'a' * 40
        # Run the actual pre-backup deployment path with isolated locks, paths and
        # a synthetic branch lookup. Stop before Docker or any business data I/O.
        source = (Path(__file__).resolve().parents[2] / 'deploy/vps/deploy-release.sh').read_text()
        self.script = source.split('exec > >(tee', 1)[0]
        self.script = self.script.replace('/opt/bhome-backups', str(self.backups))
        self.script = self.script.replace('/opt/bhome-deploy', str(self.root / 'deploy'))
        self.script = self.script.replace('/run/lock', str(self.root))
        self.script = 'git() { printf "%s\\n" "' + self.sha + '"; }\n' + self.script + '\nprintf "%s\\n" "$run"\n'

    def deploy(self):
        return subprocess.run(
            ['bash', '-c', self.script, 'deploy-release.sh', 'staging', self.sha,
             '123-1', *(['sha256:' + 'b' * 64] * 3)],
            text=True, capture_output=True,
        )

    def test_missing_parent_is_created_with_private_release_directory(self):
        result = self.deploy()
        self.assertEqual(result.returncode, 0, result.stderr)
        release = Path(result.stdout.strip())
        self.assertEqual(release.parent, self.backups)
        self.assertTrue(release.is_dir())
        for directory in (self.backups, release):
            self.assertEqual(stat.S_IMODE(directory.stat().st_mode), 0o700)

    def test_existing_backup_is_preserved_and_releases_are_unique(self):
        self.backups.mkdir(mode=0o700)
        previous = self.backups / 'previous.dump'
        previous.write_text('synthetic backup')
        first, second = self.deploy(), self.deploy()
        self.assertEqual(first.returncode, 0, first.stderr)
        self.assertEqual(second.returncode, 0, second.stderr)
        self.assertNotEqual(first.stdout.strip(), second.stdout.strip())
        self.assertEqual(previous.read_text(), 'synthetic backup')

    def test_invalid_parent_fails_before_release_allocation(self):
        self.backups.write_text('synthetic conflicting file')
        result = self.deploy()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(result.stdout, '')
        self.assertEqual(self.backups.read_text(), 'synthetic conflicting file')


if __name__ == '__main__':
    unittest.main()
