import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    'staging_safety', Path(__file__).resolve().parents[2] / 'deploy/vps/staging-safety.py')
safety = importlib.util.module_from_spec(spec)
spec.loader.exec_module(safety)


class StagingSafetyTests(unittest.TestCase):
    def api(self, **overrides):
        env = {
            'ASPNETCORE_ENVIRONMENT': 'Staging', 'DOTNET_ENVIRONMENT': 'Staging',
            'Deployment__Environment': 'Staging', 'Jobs__Enabled': 'false',
            'BillingAutomation__AutomaticJobsEnabled': 'false',
            'DevelopmentDatabase__InitializeOnStartup': 'false',
            'SePay__Enabled': 'true', 'SePay__Mode': 'Test',
            'ConnectionStrings__Database': 'Host=127.0.0.1;Database=' + safety.STAGE_DB + ';Password=synthetic-private',
        }
        env.update(overrides)
        return {'Config': {'Env': [k + '=' + v for k, v in env.items()]},
                'HostConfig': {'NetworkMode': 'container:stage-pg'}}

    def check(self, api, pg_id='stage-pg'):
        with patch.object(safety, 'docker', side_effect=[json.dumps([api]), json.dumps([{'Id': pg_id}])]):
            safety.check_api()

    def test_accepts_isolated_staging(self):
        self.check(self.api())
        self.check(self.api(SePay__Mode='Live'))
        self.check(self.api(BillingAutomation__AutomaticJobsEnabled='true'))

    def test_rejects_production_database_without_exposing_credentials(self):
        with self.assertRaisesRegex(ValueError, 'database target mismatch') as error:
            self.check(self.api(ConnectionStrings__Database='Host=postgres;Database=bhome;Password=synthetic-private'))
        self.assertNotIn('synthetic-private', str(error.exception))

    def test_rejects_live_payment_mode_and_unexpected_jobs(self):
        for values in ({'SePay__Mode': 'Invalid'}, {'Jobs__Enabled': 'true'},
                       {'DevelopmentDatabase__InitializeOnStartup': 'true'},
                       {'ASPNETCORE_ENVIRONMENT': 'Testing'},
                       {'BillingAutomation__AutomaticJobsEnabled': 'invalid'}):
            with self.subTest(values=values), self.assertRaises(ValueError):
                self.check(self.api(**values))

    def test_rejects_production_network_namespace(self):
        with self.assertRaisesRegex(ValueError, 'network namespace'):
            self.check(self.api(), pg_id='different-pg')

    def test_web_removes_only_marked_debug_script(self):
        html = '<html><!-- impeccable-live-start --><script src="http://localhost:8400/live.js"></script><!-- impeccable-live-end --><script src="/assets/app.js"></script></html>'
        with tempfile.TemporaryDirectory() as folder, patch.object(safety, 'docker', side_effect=[html, safety.API_ORIGIN + '\n']):
            output = Path(folder) / 'index.html'
            safety.clean_web('synthetic-image', output)
            self.assertNotIn('localhost', output.read_text())
            self.assertIn('/assets/app.js', output.read_text())

    def test_rejects_wrong_vite_api_origin(self):
        for origins in ('https://api.103.146.23.157.sslip.io\n',
                        safety.API_ORIGIN + '\nhttps://api.103.146.23.157.sslip.io\n'):
            with self.subTest(origins=origins), tempfile.TemporaryDirectory() as folder:
                with patch.object(safety, 'docker', side_effect=['<html></html>', origins]), self.assertRaises(ValueError):
                    safety.clean_web('synthetic-image', Path(folder) / 'index.html')

    def test_rejects_unmarked_insecure_script(self):
        with tempfile.TemporaryDirectory() as folder:
            with patch.object(safety, 'docker', return_value='<script src="http://other.invalid/x.js"></script>'), self.assertRaises(ValueError):
                safety.clean_web('synthetic-image', Path(folder) / 'index.html')


if __name__ == '__main__':
    unittest.main()
