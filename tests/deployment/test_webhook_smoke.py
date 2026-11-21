import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


@unittest.skipUnless(os.name == 'posix' and shutil.which('bash'), 'Requires POSIX Bash')
class WebhookSmokeTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        repository = Path(__file__).resolve().parents[2]
        source = (repository / 'deploy/vps/smoke-release.sh').read_text()
        self.script = 'webhook_policy=' + source.split('webhook_policy=', 1)[1].split('if [ -n "$sha" ]; then', 1)[0]
        shutil.copyfile(repository / 'deploy/vps/release-safety.py', self.root / 'release-safety.py')
        self.bin = self.root / 'bin'
        self.bin.mkdir()
        docker = self.bin / 'docker'
        docker.write_text('#!/usr/bin/env bash\nprintf "%s\\n" "$BHOME_TEST_INSPECT"\n')
        docker.chmod(0o700)
        curl = self.bin / 'curl'
        curl.write_text('#!/usr/bin/env python3\nimport os,sys\nfrom pathlib import Path\nPath(sys.argv[sys.argv.index("-o")+1]).write_text(os.environ["BHOME_TEST_BODY"])\nprint(os.environ["BHOME_TEST_STATUS"],end="")\n')
        curl.chmod(0o700)

    def run_check(self, enabled, status, body):
        environment = os.environ | {
            'PATH': str(self.bin) + os.pathsep + os.environ['PATH'],
            'BHOME_TEST_INSPECT': json.dumps([{'Config': {'Env': ['SePay__Enabled=' + enabled]}}]),
            'BHOME_TEST_STATUS': str(status),
            'BHOME_TEST_BODY': body,
        }
        script = 'set -euo pipefail\ntarget=production\napi=https://api.example.invalid\nheaders=$1\n' + self.script
        return subprocess.run(['bash', '-c', script, str(self.root / 'smoke-release.sh'), str(self.root / 'headers')],
                              env=environment, text=True, capture_output=True)

    def test_disabled_provider_requires_503_and_the_backend_disabled_code(self):
        result = self.run_check('false', 503, '{"code":"sepay_disabled"}')
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_enabled_provider_requires_401_and_the_authentication_error_code(self):
        result = self.run_check('true', 401, '{"code":"sepay_authentication_failed"}')
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_http_success_proxy_failure_and_wrong_provider_state_are_rejected(self):
        for enabled, status, body in [
            ('false', 200, '{}'),
            ('false', 503, '<html>proxy unavailable</html>'),
            ('false', 503, '{"code":"unrelated_outage"}'),
            ('true', 503, '{"code":"sepay_disabled"}'),
            ('yes', 503, '{"code":"sepay_disabled"}'),
        ]:
            with self.subTest(enabled=enabled, status=status, body=body):
                self.assertNotEqual(self.run_check(enabled, status, body).returncode, 0)


if __name__ == '__main__':
    unittest.main()
