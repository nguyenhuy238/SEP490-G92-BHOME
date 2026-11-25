import importlib.util
import tempfile
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path

spec = importlib.util.spec_from_file_location('backend_trx', Path(__file__).resolve().parents[2] / 'scripts/Verify-BackendTrx.py')
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)


class BackendTrxTests(unittest.TestCase):
    def test_current_discovery_requires_new_methods_and_static_theory_rows(self):
        project = guard.PROJECTS[0]
        actual = [(project + '.Class', 'Old', project + '.Class.Old')]
        guard.require_discovery(project, [project + '.Class.Old'], actual)
        with self.assertRaisesRegex(ValueError, 'did not execute'):
            guard.require_discovery(project, [project + '.Class.New'], actual)
        actual.append((project + '.Class', 'Theory', project + '.Class.Theory(value: 1)'))
        guard.require_discovery(project, [project + '.Class.Theory'], actual)
        guard.require_discovery(project, [project + '.Class.Theory(value: 1)'], actual)
        with self.assertRaisesRegex(ValueError, 'theory row did not execute'):
            guard.require_discovery(project, [project + '.Class.Theory(value: 2)'], actual)
        for invalid in ([], ['Unrelated.Class.Case']):
            with self.assertRaises(ValueError):
                guard.require_discovery(project, invalid, actual)

    def report(self, directory, project, outcomes=('Passed',), duplicate=False, skip_name=None):
        root = ET.Element('TestRun', xmlns='http://microsoft.com/schemas/VisualStudio/TeamTest/2010')
        definitions = ET.SubElement(root, 'TestDefinitions')
        results = ET.SubElement(root, 'Results')
        for index, outcome in enumerate(outcomes):
            execution_id, test_id = f'execution-{index}', f'test-{index}'
            if outcome == 'NotExecuted' and skip_name in guard.ALLOWED_SKIPS:
                test_id = guard.ALLOWED_SKIPS[skip_name]
            definition = ET.SubElement(definitions, 'UnitTest', id=test_id)
            ET.SubElement(definition, 'Execution', id=execution_id)
            name = skip_name if outcome == 'NotExecuted' and skip_name else f'{project}.Case{index}'
            class_name, method_name = name.rsplit('.', 1)
            ET.SubElement(definition, 'TestMethod', codeBase=f'/tmp/{project}.dll',
                          className=class_name, name=method_name)
            attributes = dict(executionId=execution_id, testId=test_id, testName=name, outcome=outcome)
            ET.SubElement(results, 'UnitTestResult', attributes)
            if duplicate:
                ET.SubElement(results, 'UnitTestResult', attributes)
        summary = ET.SubElement(root, 'ResultSummary', outcome='Completed')
        passed = outcomes.count('Passed')
        skipped = outcomes.count('NotExecuted')
        failed = outcomes.count('Failed')
        ET.SubElement(summary, 'Counters', total=str(len(outcomes)), executed=str(passed + failed),
                      passed=str(passed), failed=str(failed), notExecuted=str(skipped))
        path = Path(directory) / f'{project}.trx'
        ET.ElementTree(root).write(path)
        return path

    def complete(self, directory):
        for project in guard.PROJECTS:
            self.report(directory, project)

    def test_all_projects_pass_with_reported_skips(self):
        with tempfile.TemporaryDirectory() as directory:
            self.complete(directory)
            integration = 'BHome.IntegrationTests'
            self.report(directory, integration, ('Passed', 'NotExecuted'), skip_name=sorted(guard.ALLOWED_SKIPS)[0])
            expected = {project: (1, 0) for project in guard.PROJECTS}
            expected[integration] = (1, 1)
            self.assertEqual(guard.verify(directory), expected)
            self.report(directory, integration)
            expected[integration] = (1, 0)
            self.assertEqual(guard.verify(directory), expected)

    def test_new_skip_fails_even_when_other_cases_pass(self):
        with tempfile.TemporaryDirectory() as directory:
            self.complete(directory)
            self.report(directory, 'BHome.IntegrationTests', ('Passed', 'NotExecuted'))
            with self.assertRaisesRegex(ValueError, 'unexpectedly skipped test'):
                guard.verify(directory)

    def test_approved_skip_name_cannot_be_reused_with_a_new_test_id(self):
        with tempfile.TemporaryDirectory() as directory:
            self.complete(directory)
            name = sorted(guard.ALLOWED_SKIPS)[0]
            path = self.report(directory, 'BHome.IntegrationTests', ('Passed', 'NotExecuted'), skip_name=name)
            path.write_text(path.read_text().replace(guard.ALLOWED_SKIPS[name], 'different-id'))
            with self.assertRaisesRegex(ValueError, 'unexpectedly skipped test'):
                guard.verify(directory)

    def test_vstest_zero_skip_counter_and_inventory(self):
        with tempfile.TemporaryDirectory() as directory:
            self.complete(directory)
            project = 'BHome.IntegrationTests'
            path = self.report(directory, project, ('Passed', 'NotExecuted'),
                               skip_name=sorted(guard.ALLOWED_SKIPS)[0])
            path.write_text(path.read_text().replace('notExecuted="1"', 'notExecuted="0"'))
            self.assertEqual(guard.verify(directory)[project], (1, 1))
            self.report(directory, project)
            baseline = {}
            guard.verify(directory, inventory=baseline)
            self.assertEqual(guard.verify(directory, baseline)[project], (1, 0))
            self.report(directory, project, ('Passed', 'Passed'))
            self.assertEqual(guard.verify(directory, baseline)[project], (2, 0))
            # A candidate cannot silently replace a previously mandatory test.
            path = self.report(directory, project)
            path.write_text(path.read_text().replace('Case0', 'Replacement'))
            with self.assertRaisesRegex(ValueError, 'missing test identity'):
                guard.verify(directory, baseline)

    def test_cross_platform_infinity_and_ambiguous_theory_identity(self):
        cls = 'BHome.Application.UnitTests.Ocr.AutomaticOcrTests'
        method = 'InvalidOrLowVisualConfidenceIsExplicitlyAmbiguous'
        prefix = f'{cls}.{method}'
        self.assertEqual(
            guard.identity_key(cls, method, prefix + '(confidence: Infinity)'),
            guard.identity_key(cls, method, prefix + '(confidence: ∞)'))
        self.assertNotEqual(
            guard.identity_key(cls, method, prefix + '(confidence: -Infinity)'),
            guard.identity_key(cls, method, prefix + '(confidence: Infinity)'))
        cls = 'BHome.IntegrationTests.Ocr.MeterSceneSelectionTests'
        method = 'InvalidOrLowConfidenceCannotBecomeAReading'
        prefix = f'{cls}.{method}'
        self.assertEqual(
            guard.identity_key(cls, method, prefix + '(confidence: Infinity)'),
            guard.identity_key(cls, method, prefix + '(confidence: ∞)'))
        self.assertNotEqual(
            guard.identity_key('Unrelated', method, '(confidence: Infinity)'),
            guard.identity_key('Unrelated', method, '(confidence: ∞)'))
        key = guard.identity_key('Class', 'Theory', 'Class.Theory(truncated...)')
        expected = {'count': 2, 'cases': {key: ['id-a', 'id-b']}}
        guard.require_inventory('project', expected, {key: ['id-a', 'id-b', 'id-c']})
        with self.assertRaisesRegex(ValueError, 'changed test ID'):
            guard.require_inventory('project', expected, {key: ['id-a', 'id-c']})
        with self.assertRaisesRegex(ValueError, 'missing test identity'):
            guard.require_inventory('project', expected, {key: ['id-a']})
        with self.assertRaisesRegex(ValueError, 'changed test ID'):
            guard.require_inventory('project', {'count': 1, 'cases': {key: ['id-a']}},
                                    {key: ['id-z']})

    def test_explicit_shard_aggregation_rejects_missing_empty_and_duplicate_results(self):
        with tempfile.TemporaryDirectory() as directory:
            self.complete(directory)
            project = 'BHome.IntegrationTests'
            path = self.report(directory, project, ('Passed', 'Passed'))
            baseline = {}
            guard.verify(directory, inventory=baseline)
            first = path.read_text()
            root = ET.fromstring(first)
            for group in ('TestDefinitions', 'Results'):
                element = root.find('{*}' + group)
                element.remove(element[1])
            for counter in ('total', 'executed', 'passed'):
                root.find('.//{*}Counters').set(counter, '1')
            ET.ElementTree(root).write(path)
            with self.assertRaisesRegex(ValueError, 'Missing integration shard'):
                guard.verify(directory, integration_shards=2)
            second = path.with_name('second.trx')
            second.write_bytes(path.read_bytes())
            with self.assertRaisesRegex(ValueError, 'across shards'):
                guard.verify(directory, integration_shards=2)
            second.write_text(path.read_text().replace('test-0', 'test-1')
                              .replace('execution-0', 'execution-1').replace('Case0', 'Case1'))
            self.assertEqual(guard.verify(directory, baseline, integration_shards=2)[project], (2, 0))
            with self.assertRaisesRegex(ValueError, 'duplicate report'):
                guard.verify(directory)
            second.write_text('<TestRun/>')
            with self.assertRaises(ValueError):
                guard.verify(directory, integration_shards=2)

    def test_parameterized_display_names_may_collide_but_ids_may_not(self):
        with tempfile.TemporaryDirectory() as directory:
            self.complete(directory)
            project = guard.PROJECTS[0]
            path = self.report(directory, project, ('Passed', 'Passed'))
            path.write_text(path.read_text().replace(f'{project}.Case1', f'{project}.Case0'))
            self.assertEqual(guard.verify(directory)[project], (2, 0))
            path.write_text(path.read_text().replace('test-1', 'test-0'))
            with self.assertRaisesRegex(ValueError, 'duplicate test result'):
                guard.verify(directory)

    def test_missing_empty_failed_and_all_skipped_projects_fail(self):
        for outcomes in (None, (), ('Failed',), ('NotExecuted',)):
            with self.subTest(outcomes=outcomes), tempfile.TemporaryDirectory() as directory:
                self.complete(directory)
                project = guard.PROJECTS[-1]
                if outcomes is None:
                    (Path(directory) / f'{project}.trx').unlink()
                else:
                    self.report(directory, project, outcomes)
                with self.assertRaises(ValueError):
                    guard.verify(directory)

    def test_duplicate_project_or_test_case_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            self.complete(directory)
            project = guard.PROJECTS[0]
            self.report(directory, project, duplicate=True)
            with self.assertRaisesRegex(ValueError, 'duplicate test result'):
                guard.verify(directory)
            path = self.report(directory, project)
            path.with_name('duplicate.trx').write_bytes(path.read_bytes())
            with self.assertRaisesRegex(ValueError, 'duplicate report'):
                guard.verify(directory)

    def test_truncated_or_inconsistent_report_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            self.complete(directory)
            path = Path(directory) / f'{guard.PROJECTS[0]}.trx'
            path.write_text(path.read_text().replace('total="1"', 'total="3"'), encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'inconsistent total'):
                guard.verify(directory)
            path.write_text('<TestRun>', encoding='utf-8')
            with self.assertRaises(ET.ParseError):
                guard.verify(directory)


if __name__ == '__main__':
    unittest.main()
