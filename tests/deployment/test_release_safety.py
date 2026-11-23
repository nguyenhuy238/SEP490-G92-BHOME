import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('release_safety', Path(__file__).resolve().parents[2] / 'deploy/vps/release-safety.py')
safety = importlib.util.module_from_spec(spec)
spec.loader.exec_module(safety)


class ReleaseSafetyTests(unittest.TestCase):
    def test_enabled_provider_requires_authentication_rejection(self):
        with patch.object(safety, 'env', return_value={'SePay__Enabled': 'true', 'SePay__Mode': 'Test'}):
            self.assertEqual(safety.webhook_policy('staging'), (401, 'sepay_authentication_failed'))

    def test_staging_smoke_cannot_accept_disabled_or_live_provider(self):
        for settings in ({'SePay__Enabled': 'false', 'SePay__Mode': 'Test'}, {'SePay__Enabled': 'true', 'SePay__Mode': 'Live'}):
            with self.subTest(settings=settings), patch.object(safety, 'env', return_value=settings), self.assertRaises(ValueError):
                safety.webhook_policy('staging')

    def test_disabled_production_provider_requires_explicit_disabled_rejection(self):
        with patch.object(safety, 'env', return_value={'SePay__Enabled': 'false'}):
            self.assertEqual(safety.webhook_policy('production'), (503, 'sepay_disabled'))

    def test_missing_or_invalid_provider_flag_cannot_weaken_webhook_smoke(self):
        for settings in ({}, {'SePay__Enabled': 'yes'}, {'SePay__Enabled': ''}):
            with self.subTest(settings=settings), patch.object(safety, 'env', return_value=settings), self.assertRaises(ValueError):
                safety.webhook_policy('production')

    def configuration(self, target):
        stage = target == 'staging'
        return {
            **{key: 'Staging' if stage else 'Production' for key in ('ASPNETCORE_ENVIRONMENT', 'DOTNET_ENVIRONMENT', 'Deployment__Environment')},
            **{key: 'false' for key in ('DevelopmentDatabase__InitializeOnStartup', 'Jobs__Enabled', 'BillingAutomation__AutomaticJobsEnabled')},
            **{key: target + '-synthetic' for key in ('Jwt__SigningKey', 'Jwt__Issuer', 'Jwt__Audience', 'ObjectStorage__AccessKey', 'ObjectStorage__SecretKey', 'ObjectStorage__Bucket')},
            'ConnectionStrings__Database': 'Host=postgres;Database=' + (safety.STAGE if stage else 'bhome') + ';Password=synthetic-private',
            'SePay__Enabled': 'true' if stage else 'false', 'SePay__Mode': 'Test' if stage else 'Live',
            'Deployment__OwnerOrigin': 'https://owner-staging.103.146.23.157.sslip.io' if stage else 'https://owner.103.146.23.157.sslip.io',
            'Deployment__ApiOrigin': 'https://api-staging.103.146.23.157.sslip.io' if stage else 'https://api.103.146.23.157.sslip.io',
            'Deployment__PublicOrigin': 'https://public-staging.103.146.23.157.sslip.io' if stage else 'https://www.103.146.23.157.sslip.io',
        }

    def check(self, stage, prod, target='staging'):
        with patch.object(safety, 'env', side_effect=[stage, prod]):
            return safety.check_environment(target)

    def pdf_tools(self):
        return {'MainDraft__LibreOfficePath': '/usr/bin/libreoffice', 'MainDraft__PdfToPpmPath': '/usr/bin/pdftoppm'}

    def test_release_image_pdf_defaults_do_not_change_private_configuration_fingerprint(self):
        for target in ('staging', 'production'):
            with self.subTest(target=target):
                stage, prod = self.configuration('staging'), self.configuration('production')
                before = self.check(stage, prod, target)
                (stage if target == 'staging' else prod).update(self.pdf_tools())
                self.assertEqual(before, self.check(stage, prod, target))

    def test_pdf_tool_override_is_rejected_without_exposing_its_value(self):
        for target in ('staging', 'production'):
            for key in self.pdf_tools():
                stage, prod = self.configuration('staging'), self.configuration('production')
                (stage if target == 'staging' else prod)[key] = '/tmp/synthetic-private-executable'
                with self.subTest(target=target, key=key):
                    with self.assertRaises(ValueError) as error:
                        self.check(stage, prod, target)
                    self.assertIn(key, str(error.exception))
                    self.assertNotIn('synthetic-private', str(error.exception))

    def test_other_draft_options_and_credentials_still_change_fingerprint(self):
        for key, value in [('MainDraft__LibreOfficeContainerImage', 'synthetic-converter'),
                           ('Jwt__SigningKey', 'synthetic-rotated-private-key')]:
            stage, prod = self.configuration('staging'), self.configuration('production')
            before = self.check(stage, prod)
            stage.update(self.pdf_tools())
            stage[key] = value
            with self.subTest(key=key):
                self.assertNotEqual(before, self.check(stage, prod))

    def test_snapshot_accepts_pdf_defaults_but_rejects_protected_container_changes(self):
        containers = [{'Id': 'synthetic-id', 'Image': 'synthetic-image', 'Mounts': [], 'started': 'synthetic-start'}]
        stage, prod = self.configuration('staging'), self.configuration('production')
        with tempfile.TemporaryDirectory() as directory:
            path = str(Path(directory) / 'protected.json')
            with patch.object(safety, 'protected', return_value=containers), \
                    patch.object(safety, 'env', side_effect=[stage.copy(), prod.copy()]), \
                    patch.object(safety.sys, 'argv', ['release-safety.py', 'snapshot', 'staging', path]):
                safety.main()
            stage.update(self.pdf_tools())
            with patch.object(safety, 'protected', return_value=containers), \
                    patch.object(safety, 'env', side_effect=[stage.copy(), prod.copy()]), \
                    patch.object(safety.sys, 'argv', ['release-safety.py', 'unchanged', 'staging', path]):
                safety.main()
            for key, value in [('Id', 'recreated'), ('Image', 'changed'), ('Mounts', [{'Source': '/other'}]), ('started', 'restarted')]:
                changed = [containers[0] | {key: value}]
                with self.subTest(key=key), patch.object(safety, 'protected', return_value=changed), \
                        patch.object(safety, 'env', side_effect=[stage.copy(), prod.copy()]), \
                        patch.object(safety.sys, 'argv', ['release-safety.py', 'unchanged', 'staging', path]), \
                        self.assertRaisesRegex(ValueError, 'Protected containers'):
                    safety.main()

    def test_isolated_databases_keys_and_storage(self):
        self.assertRegex(self.check(self.configuration('staging'), self.configuration('production')), r'^[a-f0-9]{64}$')

    def test_shared_credentials_are_rejected_without_values(self):
        for key in ('Jwt__SigningKey', 'Jwt__Issuer', 'Jwt__Audience', 'ObjectStorage__AccessKey', 'ObjectStorage__SecretKey'):
            stage, prod = self.configuration('staging'), self.configuration('production')
            stage[key] = prod[key]
            with self.subTest(key=key), self.assertRaises(ValueError) as error:
                self.check(stage, prod)
            self.assertNotIn(prod[key], str(error.exception))

    def test_wrong_database_and_initializer_are_rejected(self):
        for key, value in [('ConnectionStrings__Database', 'Host=postgres;Database=bhome;Password=synthetic-private'), ('DevelopmentDatabase__InitializeOnStartup', 'true'), ('SePay__Mode', 'Live')]:
            stage = self.configuration('staging'); stage[key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.check(stage, self.configuration('production'))

    def test_mutated_tag_or_wrong_commit_cannot_be_deployed(self):
        sha = 'a' * 40
        for image in ('ghcr.io/nguyenhuy238/bhome-api:latest', 'ghcr.io/nguyenhuy238/bhome-api:sha-' + 'b' * 40 + '@sha256:' + 'c' * 64):
            with self.subTest(image=image), self.assertRaises(ValueError):
                safety.verify_image(image, sha, 'api', 'staging')

    def test_rejects_digest_and_revision_mismatch(self):
        sha, digest = 'a' * 40, 'sha256:' + 'c' * 64
        image = 'ghcr.io/nguyenhuy238/bhome-api:sha-' + sha + '@' + digest
        for labels, digests in [({'org.opencontainers.image.revision': 'b' * 40}, [image]), ({'org.opencontainers.image.revision': sha}, ['repo@sha256:' + 'd' * 64])]:
            with patch.object(safety, 'docker', return_value=json.dumps([{'Config': {'Labels': labels}, 'RepoDigests': digests}])), self.assertRaises(ValueError):
                safety.verify_image(image, sha, 'api', 'staging')

    def test_forced_ssh_commands_reject_shell_injection(self):
        import re
        pattern = re.compile(r'^/opt/bhome-deploy/staging/run-staging-release\.sh ([0-9a-f]{40}) ([0-9]+-[0-9]+) (sha256:[0-9a-f]{64}) (sha256:[0-9a-f]{64}) (sha256:[0-9a-f]{64})$')
        command = '/opt/bhome-deploy/staging/run-staging-release.sh ' + 'a' * 40 + ' 100-1' + (' sha256:' + 'c' * 64) * 3
        self.assertIsNotNone(pattern.fullmatch(command))
        for suffix in (';whoami', ' $(id)', '\nwhoami', ' /tmp/other'):
            self.assertIsNone(pattern.fullmatch(command + suffix))


if __name__ == '__main__':
    unittest.main()
