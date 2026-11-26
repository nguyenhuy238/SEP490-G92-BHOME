import os
import shutil
import subprocess
import unittest
from pathlib import Path


@unittest.skipUnless(os.name == 'posix' and shutil.which('bash'), 'Requires POSIX Bash')
class ReleaseDiskReserveTests(unittest.TestCase):
    def setUp(self):
        source = (Path(__file__).resolve().parents[2] / 'deploy/vps/deploy-release.sh').read_text()
        # Exercise the deployed shell guard without reading VPS paths or calling Docker.
        start = source.index('available_bytes=')
        end = source.index('# A reviewed schema baseline', start)
        self.script = (
            'set -euo pipefail\n'
            'df() { printf "Avail\\n%s\\n" "$SYNTHETIC_AVAILABLE_BYTES"; }\n'
            + source[start:end]
            + 'printf "DISK_RESERVE_PASS\\n"\n'
        )

    def check(self, available):
        return subprocess.run(
            ['bash', '-c', self.script], text=True, capture_output=True,
            env={**os.environ, 'SYNTHETIC_AVAILABLE_BYTES': available},
        )

    def test_allows_more_than_four_gib_even_with_df_whitespace(self):
        result = self.check('  4294967297  ')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, 'DISK_RESERVE_PASS\n')
        self.assertEqual(result.stderr, '')

    def test_rejects_exactly_four_gib_with_an_actionable_error(self):
        result = self.check('4294967296')
        self.assertEqual(result.returncode, 7)
        self.assertEqual(result.stdout, '')
        self.assertIn('Insufficient free disk space for release', result.stderr)
        self.assertIn('available=4294967296 bytes', result.stderr)
        self.assertIn('required more than 4294967296 bytes on /opt', result.stderr)

    def test_reproduces_run_359_low_space_without_continuing(self):
        result = self.check('3218841600')
        self.assertEqual(result.returncode, 7)
        self.assertEqual(result.stdout, '')
        self.assertIn('available=3218841600 bytes', result.stderr)

    def test_missing_or_malformed_disk_output_fails_closed(self):
        for available in ('', 'unknown', '-1', '4G'):
            with self.subTest(available=available):
                result = self.check(available)
                self.assertEqual(result.returncode, 7)
                self.assertEqual(result.stdout, '')
                self.assertIn('Insufficient free disk space for release', result.stderr)


if __name__ == '__main__':
    unittest.main()
