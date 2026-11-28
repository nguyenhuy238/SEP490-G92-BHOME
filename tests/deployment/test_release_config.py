import copy
import importlib.util
import json
import os
import shutil
import stat
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('release_config', ROOT / 'deploy/vps/release-config.py')
config = importlib.util.module_from_spec(spec)
spec.loader.exec_module(config)


class ReleaseConfigTests(unittest.TestCase):
    def environment(self, manual='true'):
        return {**{key: 'Staging' for key in ('ASPNETCORE_ENVIRONMENT', 'DOTNET_ENVIRONMENT', 'Deployment__Environment')},
                'BillingAutomation__ManualActionsEnabled': manual, 'Jwt__SigningKey': 'synthetic-private'}

    def test_bootstrap_preserves_running_value_without_copying_secrets(self):
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / 'runtime.yml'
            self.assertTrue(config.bootstrap_staging_runtime(file, self.environment()))
            self.assertEqual(json.loads(file.read_text())['services']['api']['environment'],
                             {'BillingAutomation__ManualActionsEnabled': 'true'})
            self.assertNotIn('synthetic-private', file.read_text())
            if os.name == 'posix':
                self.assertEqual(stat.S_IMODE(file.stat().st_mode), 0o600)

    def test_releases_do_not_overwrite_operator_settings(self):
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / 'runtime.yml'
            original = '{"services":{"api":{"environment":{"OperatorSetting":"keep"}}}}'
            file.write_text(original)
            self.assertFalse(config.bootstrap_staging_runtime(file, self.environment()))
            self.assertEqual(file.read_text(), original)

    def test_bootstrap_defaults_off_and_rejects_wrong_environment_or_invalid_flag(self):
        with tempfile.TemporaryDirectory() as directory:
            for index, mutation in enumerate([{'ASPNETCORE_ENVIRONMENT': 'Production'},
                                              {'Deployment__Environment': 'Production'},
                                              {'BillingAutomation__ManualActionsEnabled': 'yes'}]):
                file = Path(directory) / str(index)
                with self.assertRaises(ValueError):
                    config.bootstrap_staging_runtime(file, self.environment() | mutation)
                self.assertFalse(file.exists())
            environment = self.environment()
            environment.pop('BillingAutomation__ManualActionsEnabled')
            file = Path(directory) / 'default.yml'
            config.bootstrap_staging_runtime(file, environment)
            self.assertIn('false', file.read_text())

    def configurations(self):
        before = {'services': {name: {'image': name + ':old', 'environment': {'SETTING': 'synthetic-private'}}
                               for name in ('api', 'owner-web', 'public-web')},
                  'volumes': {'database': {}}}
        before['services']['postgres'] = {'image': 'postgres:16', 'volumes': ['database:/data']}
        images = {name: name + ':new' for name in ('api', 'owner-web', 'public-web')}
        after = copy.deepcopy(before)
        for name, image in images.items():
            after['services'][name]['image'] = image
        return before, after, images

    def test_image_only_transition_preserves_input_and_all_settings(self):
        before, after, images = self.configurations()
        original = copy.deepcopy(before)
        config.check_image_only_transition(before, after, images)
        self.assertEqual(before, original)

    def test_explicit_ocr_compose_overrides_cannot_be_added_removed_or_changed(self):
        for key, value, changed in [('Ocr__Enabled', 'true', 'false'),
                                    ('Ocr__ModelDirectory', '/models', '/operator/models')]:
            for mutation in ('add', 'remove', 'change'):
                before, after, images = self.configurations()
                old_env = before['services']['api']['environment']
                new_env = after['services']['api']['environment']
                if mutation != 'add':
                    old_env[key] = value
                if mutation != 'remove':
                    new_env[key] = changed if mutation == 'change' else value
                with self.subTest(key=key, mutation=mutation), self.assertRaises(ValueError):
                    config.check_image_only_transition(before, after, images)

    def test_environment_mounts_networks_protected_images_and_removed_services_are_rejected(self):
        for mutation in ('environment', 'mount', 'network', 'database-image', 'remove-service', 'wrong-image'):
            before, after, images = self.configurations()
            if mutation == 'environment':
                after['services']['api']['environment'] = {}
            elif mutation == 'mount':
                after['services']['api']['volumes'] = ['other:/data']
            elif mutation == 'network':
                after['services']['api']['networks'] = ['other']
            elif mutation == 'database-image':
                after['services']['postgres']['image'] = 'postgres:other'
            elif mutation == 'remove-service':
                del after['services']['owner-web']
            else:
                after['services']['api']['image'] = 'unverified:latest'
            with self.subTest(mutation=mutation), self.assertRaises(ValueError) as error:
                config.check_image_only_transition(before, after, images)
            self.assertNotIn('synthetic-private', str(error.exception))

    @unittest.skipUnless(shutil.which('docker'), 'Requires Docker Compose parser, no containers are started')
    def test_real_compose_repeated_releases_and_rollback_keep_demo_and_private_settings(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            base, runtime, release = (root / name for name in ('base.yml', 'runtime.yml', 'release.yml'))
            base.write_text(json.dumps({'services': {
                'api': {'image': 'api:base', 'environment': {'Jwt__SigningKey': 'synthetic-private', 'Jobs__Enabled': 'false'}},
                'owner-web': {'image': 'owner:base'}, 'public-web': {'image': 'public:base'}}}))
            config.bootstrap_staging_runtime(runtime, self.environment())
            source = (ROOT / 'deploy/vps/deploy-release.sh').read_text()
            template = source.split('cat > "$run/release.next.yml" <<YAML\n', 1)[1].split('\nYAML', 1)[0]

            def render(number, legacy=False):
                images = {'api': f'api:v{number}', 'owner-web': f'owner:v{number}', 'public-web': f'public:v{number}'}
                text = template.replace('$api', images['api']).replace('$owner', images['owner-web']).replace('$public', images['public-web'])
                if legacy:
                    text = text.replace('  api:\n', '  api:\n    environment:\n      BillingAutomation__ManualActionsEnabled: "true"\n')
                release.write_text(text)
                return images

            def resolved():
                return json.loads(subprocess.check_output(['docker', 'compose', '-p', 'bhome-retention-test',
                    '-f', str(base), '-f', str(runtime), '-f', str(release), 'config', '--format', 'json'], text=True))

            render(1, legacy=True)
            old_file, first = release.read_text(), resolved()
            for number in (2, 3):
                images = render(number)
                current = resolved()
                config.check_image_only_transition(first, current, images)
                self.assertEqual(current['services']['api']['environment']['BillingAutomation__ManualActionsEnabled'], 'true')
                self.assertEqual(current['services']['api']['environment']['Jwt__SigningKey'], 'synthetic-private')
                first = current
            runtime.write_text('{"services":{"api":{"environment":{"BillingAutomation__ManualActionsEnabled":"false"}}}}')
            with self.assertRaises(ValueError):
                config.check_image_only_transition(first, resolved(), images)
            release.write_text(old_file)
            self.assertEqual(resolved()['services']['api']['environment']['BillingAutomation__ManualActionsEnabled'], 'true')


if __name__ == '__main__':
    unittest.main()
