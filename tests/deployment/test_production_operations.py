import datetime
import importlib.util
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('production_operations', Path(__file__).resolve().parents[2] / 'deploy/vps/production-operations.py')
operations = importlib.util.module_from_spec(spec)
spec.loader.exec_module(operations)


class ProductionOperationsTests(unittest.TestCase):
    def test_stopped_unhealthy_or_starting_container_fails_before_http_checks(self):
        for state in ({'Running': False}, {'Running': True, 'Health': {'Status': 'unhealthy'}},
                      {'Running': True, 'Health': {'Status': 'starting'}}):
            with self.subTest(state=state), patch.object(operations, 'inspect', return_value=[{'Name': 'synthetic-api', 'State': state}]), \
                    patch.object(operations, 'command') as command, self.assertRaisesRegex(ValueError, 'Unhealthy container'):
                operations.health()
            command.assert_not_called()

    def test_disk_reserve_failure_cannot_report_healthy(self):
        with patch.object(operations, 'inspect', return_value=[]), \
                patch.object(operations.shutil, 'disk_usage', return_value=operations.shutil._ntuple_diskusage(10, 8, 2)), \
                patch.object(operations, 'command') as command, self.assertRaisesRegex(ValueError, '4 GiB'):
            operations.health()
        command.assert_not_called()

    @unittest.skipUnless(os.name == 'posix' and os.geteuid() == 0, 'Root-only Linux retention ownership checks')
    def test_retention_removes_only_expired_verified_tool_backups(self):
        with tempfile.TemporaryDirectory() as directory:
            parent = Path(directory)
            def create(name, *, days=9, verified=True, kind='bhome-production-scheduled-backup-v1'):
                root = parent / name
                root.mkdir()
                marker = {'kind': kind, 'restoreVerified': verified,
                          'createdAt': (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=days)).isoformat()}
                (root / 'backup-manifest.json').write_text(json.dumps(marker))
                return root
            expired = create('production-scheduled-backup-expired')
            recent = create('production-scheduled-backup-recent', days=1)
            incomplete = create('production-scheduled-backup-incomplete', verified=False)
            unknown = create('production-scheduled-backup-unknown', kind='other-tool')
            current = create('production-scheduled-backup-current')
            unrelated = create('production-preflight-keep')
            broken = create('production-scheduled-backup-broken')
            (broken / 'backup-manifest.json').write_text('invalid JSON')
            alias = parent / 'production-scheduled-backup-symlink'
            alias.symlink_to(unrelated, target_is_directory=True)
            with patch.object(operations, 'BACKUPS', parent):
                operations.prune_backups(current, 7)
            self.assertFalse(expired.exists())
            for kept in (recent, incomplete, unknown, current, unrelated, broken, alias):
                self.assertTrue(kept.exists(), str(kept))


if __name__ == '__main__':
    unittest.main()
