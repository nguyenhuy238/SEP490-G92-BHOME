import hashlib
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    'release_manifest', Path(__file__).resolve().parents[2] / 'scripts/Build-ReleaseManifest.py')
manifest = importlib.util.module_from_spec(spec)
spec.loader.exec_module(manifest)


class ReleaseManifestTests(unittest.TestCase):
    def environment(self, production=False):
        target = 'Production' if production else 'Staging'
        sha = 'a' * 40
        env = {
            'GITHUB_REF': 'refs/heads/main' if production else 'refs/heads/develop',
            'GITHUB_EVENT_NAME': 'push', 'GITHUB_SHA': sha,
            'GITHUB_RUN_ID': '123', 'GITHUB_RUN_ATTEMPT': '2',
            'GITHUB_REPOSITORY_OWNER': 'Example', 'REGISTRY': 'ghcr.io/example',
            'TARGET': target, 'SUFFIX': '-production' if production else '',
        }
        for key, digit in [('API', '1'), ('OWNER', '2'), ('PUBLIC', '3')]:
            env[key + '_DIGEST'] = 'sha256:' + digit * 64
            env[key + '_PROVENANCE'] = f'{sha}:123-2:{target}'
        return env

    def test_staging_and_production_use_exact_environment_images(self):
        for production in (False, True):
            env = self.environment(production)
            result = manifest.build(env)
            self.assertEqual(result['sha'], env['GITHUB_SHA'])
            self.assertEqual(result['run'], '123-2')
            self.assertEqual(result['environment'], env['TARGET'])
            for app, key in [('api', 'API'), ('owner-web', 'OWNER'), ('public-web', 'PUBLIC')]:
                suffix = env['SUFFIX'] if app != 'api' else ''
                self.assertEqual(result['images'][app],
                                 f"ghcr.io/example/bhome-{app}{suffix}:sha-{env['GITHUB_SHA']}@{env[key + '_DIGEST']}")

    def test_wrong_revision_attempt_environment_or_digest_fails(self):
        for key, value in [
            ('GITHUB_EVENT_NAME', 'pull_request'), ('GITHUB_REF', 'refs/heads/member/QHuy'),
            ('TARGET', 'Production'), ('SUFFIX', '-production'), ('REGISTRY', 'ghcr.io/other'),
            ('GITHUB_SHA', 'bad'), ('GITHUB_RUN_ATTEMPT', '3'), ('API_DIGEST', ''),
            ('OWNER_DIGEST', 'latest'), ('PUBLIC_PROVENANCE', 'b' * 40 + ':123-2:Staging'),
            ('OWNER_PROVENANCE', 'a' * 40 + ':123-1:Staging'),
            ('API_PROVENANCE', 'a' * 40 + ':123-2:Production'),
        ]:
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                manifest.build({**self.environment(), key: value})
        env = self.environment()
        del env['PUBLIC_DIGEST']
        with self.assertRaises(KeyError):
            manifest.build(env)

    def test_downloaded_manifest_must_match_checksum_and_deployment_inputs(self):
        for production in (False, True):
            with tempfile.TemporaryDirectory() as directory:
                env = self.environment(production)
                path = Path(directory) / 'release-manifest.json'
                path.write_text(json.dumps(manifest.build(env)), encoding='utf-8')
                checksum = hashlib.sha256(path.read_bytes()).hexdigest()
                manifest.verify_download(path, checksum, env)
                for key, value in [('GITHUB_RUN_ATTEMPT', '3'), ('GITHUB_SHA', 'b' * 40),
                                   ('OWNER_DIGEST', 'sha256:' + '4' * 64)]:
                    with self.subTest(key=key), self.assertRaises(ValueError):
                        manifest.verify_download(path, checksum, {**env, key: value})
                path.write_text('{}', encoding='utf-8')
                with self.assertRaisesRegex(ValueError, 'checksum'):
                    manifest.verify_download(path, checksum, env)

    def test_staging_retry_verifies_the_original_producer_attempt(self):
        with tempfile.TemporaryDirectory() as directory:
            env = self.environment()
            path = Path(directory) / 'release-manifest.json'
            path.write_text(json.dumps(manifest.build(env)), encoding='utf-8')
            checksum = hashlib.sha256(path.read_bytes()).hexdigest()
            retry = dict(env, GITHUB_RUN_ATTEMPT='3', STAGING_MANIFEST_ATTEMPT='2')
            manifest.verify_download(path, checksum, retry)
            for key, value in [('STAGING_MANIFEST_ATTEMPT', ''), ('STAGING_MANIFEST_ATTEMPT', '4'),
                               ('STAGING_MANIFEST_ATTEMPT', '1'), ('STAGING_MANIFEST_ATTEMPT', '03'),
                               ('GITHUB_RUN_ID', '124'), ('GITHUB_SHA', 'b' * 40),
                               ('API_DIGEST', 'sha256:' + '9' * 64)]:
                with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                    manifest.verify_download(path, checksum, {**retry, key: value})
            with self.assertRaisesRegex(ValueError, 'checksum'):
                manifest.verify_download(path, '0' * 64, retry)

    def test_production_cannot_use_staging_retry_exception(self):
        with tempfile.TemporaryDirectory() as directory:
            env = self.environment(production=True)
            path = Path(directory) / 'release-manifest.json'
            path.write_text(json.dumps(manifest.build(env)), encoding='utf-8')
            checksum = hashlib.sha256(path.read_bytes()).hexdigest()
            with self.assertRaisesRegex(ValueError, 'Invalid Staging'):
                manifest.verify_download(path, checksum, dict(
                    env, GITHUB_RUN_ATTEMPT='3', STAGING_MANIFEST_ATTEMPT='2'))
