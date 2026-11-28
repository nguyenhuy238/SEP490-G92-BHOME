import importlib.util
import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('sepay_release_safety', Path(__file__).resolve().parents[2] / 'deploy/vps/release-safety.py')
safety = importlib.util.module_from_spec(spec)
spec.loader.exec_module(safety)


class SePayModeSafetyTests(unittest.TestCase):
    def test_dual_mode_compose_overlay_preserves_server_only_profiles(self):
        root = Path(__file__).resolve().parents[2]
        self.assertIsNotNone(shutil.which('docker'), 'Docker Compose is required by deployment CI')
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / 'compose.json'
            base.write_text(json.dumps({'services': {'api': {'image': 'bhome/api:syntax-validation'}}}))
            environment = dict(os.environ, BHOME_SEPAY_MODES_ENV_FILE=str(root / '.env.sepay-modes.example'))
            rendered = subprocess.check_output(['docker', 'compose', '-f', str(base), '-f',
                str(root / 'deploy/vps/compose.sepay-modes.example.yml'), 'config', '--format', 'json'],
                env=environment, text=True)
            api = json.loads(rendered)['services']['api']['environment']
            self.assertEqual('true', api['SePay__Test__Enabled'])
            self.assertEqual('true', api['SePay__Live__Enabled'])
            self.assertNotEqual(api['SePay__Test__WebhookSecret'], api['SePay__Live__WebhookSecret'])
            self.assertFalse(any(key.startswith(('VITE_', 'EXPO_PUBLIC_')) for key in api))

    def settings(self):
        settings = {'SePay__Enabled': 'true', 'SePay__Mode': 'Test', 'SePay__InstanceCode': 'STG1'}
        for mode, host in (('Test', 'userapi-sandbox'), ('Live', 'userapi')):
            prefix = 'SePay__' + mode + '__'
            settings.update({prefix + 'Enabled': 'true', prefix + 'ApiBaseUrl': 'https://' + host + '.sepay.vn/v2',
                             prefix + 'ApiToken': 'synthetic-' + mode, prefix + 'WebhookSecret': 'synthetic-secret-at-least-32-characters-' + mode})
        return settings

    def test_accepts_test_and_live_without_an_environment_permission(self):
        for mode in ('Test', 'Live'):
            settings = self.settings()
            settings['SePay__Mode'] = mode
            safety.validate_sepay(settings)

    def test_requires_namespaces_and_rejects_shared_profile_credentials(self):
        for key, value in (('SePay__InstanceCode', ''), ('SePay__InstanceCode', 'staging'),
                           ('SePay__Live__ApiBaseUrl', 'https://userapi-sandbox.sepay.vn/v2'),
                           ('SePay__Live__WebhookSecret', 'synthetic-secret-at-least-32-characters-Test'),
                           ('SePay__Live__ApiToken', 'synthetic-Test'), ('SePay__Test__Enabled', 'yes')):
            with self.subTest(key=key):
                settings = self.settings()
                settings[key] = value
                with self.assertRaises(ValueError):
                    safety.validate_sepay(settings)

    def test_validation_errors_do_not_print_private_values(self):
        settings = self.settings()
        settings['SePay__Live__WebhookSecret'] = 'private-secret'
        with self.assertRaises(ValueError) as caught:
            safety.validate_sepay(settings)
        self.assertNotIn('private-secret', str(caught.exception))

    def test_legacy_codes_cannot_be_owned_by_two_deployments(self):
        stage, prod = self.settings(), self.settings()
        prod['SePay__InstanceCode'] = 'PRD1'
        for mode in ('Test', 'Live'):
            prod['SePay__' + mode + '__WebhookSecret'] += '-production'
        stage['SePay__Test__LegacyPaymentCodes__0'] = 'BH12345678'
        prod['SePay__Test__LegacyPaymentCodes__0'] = 'BH12345678'
        with self.assertRaises(ValueError):
            safety.validate_sepay_routing(stage, prod)
        prod['SePay__Test__LegacyPaymentCodes__0'] = 'BH87654321'
        safety.validate_sepay_routing(stage, prod)

    def test_flat_shared_bank_must_be_upgraded_before_assigning_legacy_routes(self):
        stage = self.settings()
        stage.update({'SePay__Live__LegacyPaymentCodes__0': 'BH12345678',
                      'SePay__Live__ReceivingAccounts__0__Gateway': 'ACB',
                      'SePay__Live__ReceivingAccounts__0__AccountNumber': '0000001234'})
        prod = {'SePay__Enabled': 'true', 'SePay__Mode': 'Live',
                'SePay__ReceivingAccounts__0__Gateway': 'ACB',
                'SePay__ReceivingAccounts__0__AccountNumber': '0000001234'}
        with self.assertRaises(ValueError):
            safety.validate_sepay_routing(stage, prod)
        del stage['SePay__Live__LegacyPaymentCodes__0']
        with self.assertRaises(ValueError):
            safety.validate_sepay_routing(stage, prod)
