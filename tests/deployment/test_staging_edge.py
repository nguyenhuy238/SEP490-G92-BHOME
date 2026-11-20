import importlib.util
import json
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('edge', Path(__file__).resolve().parents[2] / 'deploy/vps/connect-staging-edge.py')
edge = importlib.util.module_from_spec(spec); spec.loader.exec_module(edge)


class StagingEdgeTests(unittest.TestCase):
    def inspect(self, name, alias):
        return json.dumps([{'NetworkSettings': {'Networks': {edge.NETWORK: {'Aliases': [name, alias]}}}}]).encode()

    def test_replaces_implicit_compose_aliases_that_can_route_production_to_staging(self):
        calls = []
        for name, alias in edge.APPS.items():
            calls += [self.inspect(name, 'api'), self.inspect(name, alias)]
        calls += [json.dumps([{'Containers': {str(i): {'Name': name} for i, name in enumerate([*edge.APPS, 'bhome-vps-caddy-1'])}}]).encode()]
        with patch.object(edge.subprocess, 'check_output', side_effect=calls), patch.object(edge.subprocess, 'run') as command:
            edge.main()
            self.assertEqual(command.call_count, 2 * len(edge.APPS))
            self.assertIn('--alias', command.call_args_list[1].args[0])
            self.assertEqual(command.call_args_list[0].args[0][2], 'disconnect')

    def test_rejects_database_or_foreign_container_on_edge(self):
        calls = [value for name, alias in edge.APPS.items() for value in [self.inspect(name, alias)] * 2]
        calls += [json.dumps([{'Containers': {'1': {'Name': 'bhome-sepay-vps-stage'}}}]).encode()]
        with patch.object(edge.subprocess, 'check_output', side_effect=calls), self.assertRaisesRegex(ValueError, 'Unexpected service'):
            edge.main()


if __name__ == '__main__':
    unittest.main()
