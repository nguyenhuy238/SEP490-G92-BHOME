import importlib.util
import json
import tempfile
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]


def module(name, file):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scripts' / file)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


discovery = module('discovery', 'Capture-BackendDiscovery.py')
planner = module('planner', 'Plan-IntegrationShards.py')
runtime = module('runtime_smoke', 'Verify-LocalReleaseImages.py')
cache = module('docker_cache', 'Measure-DockerCache.py')


class CiMeasurementTests(unittest.TestCase):
    def test_buildkit_cache_probe_matches_expanded_web_arg_and_explicit_step_id(self):
        content = '#14 [build 8/13] RUN npm ci --no-fund\n#14 CACHED\n' \
                  '#19 [build 13/13] RUN test "owner-web" = "owner-web"\n#19 DONE 1s\n'
        self.assertTrue(cache.cached_instruction(content, 'npm ci'))
        self.assertFalse(cache.cached_instruction(content, r'test "(?:owner-web|public-web)"'))
        with self.assertRaises(ValueError):
            cache.cached_instruction(content, 'dotnet restore')

    def test_discovery_uses_current_solution_and_does_not_create_a_success_on_empty_output(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'discovery'
            with patch.object(discovery.subprocess, 'run') as run:
                run.return_value.stdout = 'The following Tests are available:\n'
                with self.assertRaisesRegex(ValueError, 'Empty test discovery'):
                    discovery.capture(output, 'dotnet')
            self.assertFalse((output / 'discovery.json').exists())

    def test_class_partition_preserves_each_identity_and_skip_exactly_once(self):
        with tempfile.TemporaryDirectory() as directory:
            root = ET.Element('TestRun')
            definitions = ET.SubElement(root, 'TestDefinitions')
            results = ET.SubElement(root, 'Results')
            for index, (cls, outcome, duration) in enumerate([
                    ('A', 'Passed', '00:00:10'), ('A', 'NotExecuted', '00:00:00'),
                    ('B', 'Passed', '00:00:09'), ('C', 'Passed', '00:00:01')]):
                definition = ET.SubElement(definitions, 'UnitTest')
                ET.SubElement(definition, 'Execution', id=str(index))
                ET.SubElement(definition, 'TestMethod', className='BHome.IntegrationTests.' + cls)
                ET.SubElement(results, 'UnitTestResult', executionId=str(index), testId=str(index),
                              outcome=outcome, duration=duration)
            path = Path(directory) / 'baseline.trx'
            ET.ElementTree(root).write(path)
            result = planner.plan(path)
            self.assertEqual(result['tests'], 4)
            self.assertEqual([s['testSeconds'] for s in result['shards']], [10, 10])
            self.assertEqual(sum(s['notExecuted'] for s in result['shards']), 1)
            self.assertEqual(sorted(t for s in result['shards'] for t in s['testIds']), ['0', '1', '2', '3'])
            results[1].set('testId', '0')
            ET.ElementTree(root).write(path)
            with self.assertRaisesRegex(ValueError, 'Invalid baseline'):
                planner.plan(path)

    def test_runtime_failure_records_cleanup_without_claiming_acceptance(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'runtime'
            with patch.object(runtime, 'docker', side_effect=[None, RuntimeError('missing image')]), \
                    patch.object(runtime.subprocess, 'run') as run:
                run.return_value.returncode = 0
                with self.assertRaisesRegex(RuntimeError, 'missing image'):
                    runtime.smoke(output)
            summary = json.loads((output / 'summary.json').read_text())
            self.assertFalse(summary['completed'])
            self.assertTrue(summary['cleanup']['passed'])
            self.assertEqual(summary['cleanup']['containers'], [])
            self.assertEqual(run.call_args.args[0][:3], ['docker', 'network', 'rm'])


if __name__ == '__main__':
    unittest.main()
