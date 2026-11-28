#!/usr/bin/env python3
"""Require one complete VSTest report for each backend CI test assembly."""
import argparse
import hashlib
import json
import sys
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict
from pathlib import Path


PROJECTS = (
    'BHome.Application.UnitTests',
    'BHome.Domain.UnitTests',
    'BHome.Infrastructure.UnitTests',
    'BHome.IntegrationTests',
    'BHome.DigitalSigning.UnitTests',
)
ASSEMBLIES = {f'{project}.dll'.casefold(): project for project in PROJECTS}
SKIP_OUTCOMES = {'NotExecuted', 'Skipped'}
# CI run #339's accepted baseline: opt-in local OCR/model, browser, email
# and replaced legacy tests. Fewer skips are allowed; any new skip fails CI.
ALLOWED_SKIPS = {
    'BHome.IntegrationTests.Compact24.AuthenticationBrowserTests.OwnerRefreshesANestedPageWithTheSameOriginSecureCookieAndRealApi': '91b5967e-8de2-f6ab-8781-e8ac1ddb994e',
    'BHome.IntegrationTests.Compact24.Compact24NotificationMvpTests.DevelopmentWorkerSendsInvitationsCredentialsVerificationAndNotificationsOutsideStaleAllowlist': 'b99ec0ff-92cd-eca2-98c1-911c9b31ad1e',
    'BHome.IntegrationTests.Compact24.Compact24NotificationMvpTests.MailpitInvitationAndResetKeepExactWebAndMobileActionsAndTokensRemainOneUse': '85f3516d-22e9-14ff-7e3f-8ca03794075b',
    'BHome.IntegrationTests.Compact24.Compact24NotificationMvpTests.MailpitReceivedInvitationOpensActualWebSetupAndRejectsReuseWithoutLeakingTokenToHistory': 'b8dca451-b68f-704b-2318-55bb61d95aa7',
    'BHome.IntegrationTests.Compact24.Compact24NotificationMvpTests.MailpitReceivesOneStaffCredentialAfterSafeRetryAndCredentialLogsInChangesPasswordAndRevokesSessions': '4a1065ae-f065-40a0-90b9-e1930a9e74f6',
    'BHome.IntegrationTests.Compact24.DepositAgreementBrowserTests.OwnerBrowserCompletesAgreedRecipientRefundThroughRealApiAndPersistence': '4366d73c-e46d-3356-2b8b-c68f65969c39',
    'BHome.IntegrationTests.Compact24.LiveStep6SigningTests.HoldingAndMainInvitationAndOwnerOtpUseRealSmtp': '26a46f9a-1eba-a076-0bbf-438823dc4b08',
    'BHome.IntegrationTests.Contracts.ContractLifecycleApiTests.MoveOutDraftPersistsPartialItemsWithVersionedStaffWritesAndOwnerReadAccess': '8c71d5f7-aa29-a05e-edd0-721a1d8a4abe',
    'BHome.IntegrationTests.IncidentMaintenance.MaintenanceDemoTests.OwnerBrowserRunsProactiveRepairThroughRealStaffApiAndMinio': 'ddcae291-a485-9ec4-f22d-0cda8626847f',
    'BHome.IntegrationTests.Notifications.GmailAuthenticationSmokeTests.VerificationAndRecoveryReachTestInboxAndTheirLinksConfirmAndResetSyntheticAccount': '801bd572-08d4-5e01-81be-5be6f83b1bc0',
    'BHome.IntegrationTests.Notifications.GmailConnectionTests.ConfiguredDevelopmentSmtpAuthenticatesWithoutSendingAnyMessage': 'e7a2077e-48be-0036-3330-47ae92e35e7f',
    'BHome.IntegrationTests.Notifications.GmailConnectionTests.DevelopmentApiConfigurationRecognizesRealSigningEmailWithoutStartingWorkers': 'dce7f9be-d460-95ef-3ba2-4bcaebcf37f5',
    'BHome.IntegrationTests.Notifications.GmailSmtpSmokeTests.OneDevelopmentOwnerTestMessageIsAcceptedAndOptionallyFoundInTestInbox': '0b88a192-1257-0176-270c-8735e0107400',
    'BHome.IntegrationTests.Ocr.CompactMeterOcrWorkflowTests.AssignedExperimentalModelsRemainReadOnly': 'd130aff8-1cc2-69a8-5110-1ef1c21ad224',
    'BHome.IntegrationTests.Ocr.CompactMeterOcrWorkflowTests.RealModelsProposalCorrectionAndEvidence': 'cfde5472-7eb3-9e83-18b4-20f4f43a3ba5',
    'BHome.IntegrationTests.Ocr.ExperimentalGeometryTests.RealGreenLcdDoesNotReplaceObservedDigitsWithTheAdjacentBrand': '0f7db6c4-557c-f59e-ff4c-751dcfd9c5ad',
    'BHome.IntegrationTests.Ocr.ExperimentalMeterRuntimeTests.AmbiguousAndMalformedOptInAreRejectedBeforeInference': '19c5c72e-abcb-6d59-4de6-8c1770070dce',
    'BHome.IntegrationTests.Ocr.ExperimentalMeterRuntimeTests.FreshUnverifiedDisplaysDoNotProduceExperimentalReadings': '4763246a-0e11-7820-beee-d614aaf24a7c',
    'BHome.IntegrationTests.Ocr.ExperimentalMeterRuntimeTests.MissingAndIntegrityMismatchedModelsReturnExplicitFallback': '7bc8d526-d250-9855-5a26-8e476415b3f4',
    'BHome.IntegrationTests.Ocr.ExperimentalMeterRuntimeTests.NativePreprocessingAndRealOnnxLogitsMatchPythonReferences': 'cb3891a2-7fa4-da03-e103-a86cd67193c0',
    'BHome.IntegrationTests.Ocr.ExperimentalMeterRuntimeTests.RealOnnxRunsThroughAspNetDiagnosticsForPositiveInvalidAndUnknownImages': 'f80a09bd-fb5a-1277-9c46-c947626be874',
    'BHome.IntegrationTests.Ocr.ExperimentalMeterRuntimeTests.SameFrozenFullFramesAreMeasuredThroughBothAspNetRoutes': '2df1f371-fff2-1737-0771-4810a8f50c69',
    'BHome.IntegrationTests.Ocr.ExperimentalMeterRuntimeTests.UnitRefinementRecoversConsumptionWithoutAcceptingInvalidFullFrames': '9f235c9c-8847-7c33-db5c-f3a4a32b2af6',
    'BHome.IntegrationTests.Ocr.NewSourceClassifierRuntimeTests.AdditionalLcdTechnologyHeadMatchesRealOnnxReferencesWithoutBypassingInputValidation': '006f62b4-fea9-aef7-fd48-c37b1f6899a3',
    'BHome.IntegrationTests.Ocr.NewSourceClassifierRuntimeTests.NewSourceClassifierIsMeasuredWithoutThresholdRetuning': 'ab9e9a90-c717-2136-5515-c6b4e10428ed',
    'BHome.IntegrationTests.Ocr.OcrApiTests.RealModelsReadWaterThroughDiagnosticHttpAndResolveElectricLabelWithoutPersistence': '36fb51c8-701e-3272-bca3-ba479650863a',
    'BHome.IntegrationTests.Ocr.TrainedMeterClassifierPilotTests.RealDiClassifierFlowsThroughStaffImageHttpWithoutAutoConfirmationOrMetadataLabels': 'dd325b74-1440-e7c4-642c-453c088d9af4',
    'BHome.IntegrationTests.Ocr.TrainedMeterClassifierPilotTests.RealNineImageCheckpointMatchesPythonPreprocessingClassOrderAndDecisions': '4915f7b8-29c7-2c7e-ec79-2e8704900b33',
    'BHome.IntegrationTests.Ocr.TrustedMeterCategoryTests.TrustedProfileReachesRealPpOcrDespiteWeakCategoryHypotheses': 'd2dffee3-cbf9-9c43-6829-2d9a9de58b1e',
    'BHome.IntegrationTests.Ocr.YoloMeterCategoryClassifierTests.ClassifiedWaterUsesRealStage2DisplayReaderAndReturnsReviewCrop': '196604a5-f198-db86-21be-e0c0f1b38eb2',
    'BHome.IntegrationTests.Ocr.YoloMeterCategoryClassifierTests.ExistingRejectedThreeClassCheckpointCannotMasqueradeAsFourClasses': 'b33659f4-43a3-1f03-8ea6-5d4782d02a67',
    'BHome.IntegrationTests.Ocr.YoloMeterCategoryClassifierTests.OptionalClassifierOutagePreservesRealPpOcrAndTrustedTaskMismatchFallsBack': 'e1540737-b874-d829-fc59-118716414852',
}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def fingerprint(cases):
    return hashlib.sha256(
        json.dumps(sorted(cases), ensure_ascii=True, separators=(',', ':')).encode()
    ).hexdigest()


def identity_key(class_name, method_name, display_name):
    # The same float.PositiveInfinity theory row is rendered differently by
    # the Linux and Windows xUnit adapters in the measured reports.
    if (class_name, method_name) in {
        ('BHome.Application.UnitTests.Ocr.AutomaticOcrTests',
         'InvalidOrLowVisualConfidenceIsExplicitlyAmbiguous'),
        ('BHome.IntegrationTests.Ocr.MeterSceneSelectionTests',
         'InvalidOrLowConfidenceCannotBecomeAReading'),
    }:
        display_name = display_name.replace('(confidence: ∞)', '(confidence: Infinity)')
    return fingerprint([[class_name, method_name, display_name]])


def require_inventory(project, expected, actual):
    groups = expected['cases']
    require(groups and expected['count'] == sum(len(ids) for ids in groups.values()),
            f'{project}: invalid or empty committed inventory')
    # A reviewed assembly relocation may change an xUnit theory row ID because
    # the serialized enum parameter includes its assembly-qualified type name.
    # Preserve every original ID and require its specific measured successor in
    # the same identity group; do not accept a replacement merely by display name.
    baseline_ids = {test_id for ids in groups.values() for test_id in ids}
    transitions = expected.get('reviewedIdTransitions', {})
    require(isinstance(transitions, dict) and set(transitions).issubset(baseline_ids)
            and all(isinstance(value, str) and value and value not in baseline_ids
                    for value in transitions.values())
            and len(set(transitions.values())) == len(transitions),
            f'{project}: invalid reviewed test ID transitions')
    for key, ids in groups.items():
        require(isinstance(ids, list) and ids and len(set(ids)) == len(ids),
                f'{project}: invalid committed test identity {key}')
        found = actual.get(key, [])
        require(len(found) >= len(ids), f'{project}: missing test identity {key}')
        # All five measured Linux/Windows assemblies have identical test IDs.
        # Require those IDs even when a display name is unique.
        required_ids = {transitions.get(test_id, test_id) for test_id in ids}
        require(required_ids.issubset(found), f'{project}: missing or changed test ID {key}')


def require_discovery(project, discovered, actual):
    require(isinstance(discovered, list) and discovered, f'{project}: empty current discovery')
    methods = {f'{cls}.{method}' for cls, method, _ in actual}
    names = Counter(identity_key(cls, method, name) for cls, method, name in actual)
    required = Counter()
    for name in discovered:
        require(isinstance(name, str) and name.startswith(project + '.'),
                f'{project}: invalid discovered test')
        method = name.split('(', 1)[0]
        require(method in methods, f'{project}: discovered method did not execute: {method}')
        if '(' in name:
            cls, method_name = method.rsplit('.', 1)
            required[identity_key(cls, method_name, name)] += 1
    # xUnit defers some MemberData expansion until execution. Such methods must
    # execute; baseline row IDs still protect their previously observed cases.
    require(not (required - names), f'{project}: discovered theory row did not execute')


def verify(directory, baseline=None, inventory=None, integration_shards=1, discovery=None):
    reports = {}
    require(integration_shards >= 1, 'Invalid integration shard count')
    report_counts = Counter()
    all_cases = defaultdict(set)
    all_identities = defaultdict(lambda: defaultdict(list))
    all_legacy_identities = defaultdict(list)
    if baseline is not None:
        require(set(baseline) == set(PROJECTS), 'Inventory must cover exactly the five CI assemblies')
    if discovery is not None:
        require(set(discovery) == set(PROJECTS), 'Discovery must cover exactly the five CI assemblies')
    for file in sorted(Path(directory).rglob('*.trx')):
        root = ET.parse(file).getroot()
        definitions = {}
        projects = set()
        for definition in root.findall('./{*}TestDefinitions/{*}UnitTest'):
            method = definition.find('{*}TestMethod')
            execution = definition.find('{*}Execution')
            require(method is not None and execution is not None, f'{file}: incomplete test definition')
            assembly = method.get('codeBase', '').replace('\\', '/').rsplit('/', 1)[-1].casefold()
            project = ASSEMBLIES.get(assembly)
            require(project is not None, f'{file}: unexpected test assembly {assembly!r}')
            projects.add(project)
            key = execution.get('id')
            test_id = definition.get('id')
            require(key and test_id and key not in definitions, f'{file}: invalid or duplicate execution definition')
            definitions[key] = (test_id, method.get('className'), method.get('name'))
        require(len(projects) == 1, f'{file}: expected exactly one backend test assembly')
        project = projects.pop()
        expected_reports = integration_shards if project == 'BHome.IntegrationTests' else 1
        report_counts[project] += 1
        require(report_counts[project] <= expected_reports, f'{file}: duplicate report for {project}')

        counts = Counter()
        seen = set()
        cases = set()
        identities = defaultdict(list)
        legacy_identities = []
        skipped_names = set()
        for result in root.findall('./{*}Results/{*}UnitTestResult'):
            execution = result.get('executionId')
            test_id = result.get('testId')
            name = result.get('testName')
            require(execution in definitions and test_id == definitions[execution][0] and name,
                    f'{file}: result does not match a test definition')
            case = test_id
            require(execution not in seen and case not in cases, f'{file}: duplicate test result {name}')
            seen.add(execution)
            cases.add(case)
            _, class_name, method_name = definitions[execution]
            require(class_name and method_name, f'{file}: missing method identity')
            identities[identity_key(class_name, method_name, name)].append(test_id)
            legacy_identities.append([class_name, method_name, name])
            outcome = result.get('outcome')
            require(outcome == 'Passed' or outcome in SKIP_OUTCOMES,
                    f'{file}: {name} has outcome {outcome!r}')
            if outcome in SKIP_OUTCOMES:
                require(project == 'BHome.IntegrationTests' and ALLOWED_SKIPS.get(name) == test_id
                        and name == f'{class_name}.{method_name}',
                        f'{file}: unexpectedly skipped test {name}')
                require(name not in skipped_names, f'{file}: duplicate skipped test {name}')
                skipped_names.add(name)
            counts[outcome] += 1
        require(seen == definitions.keys() and counts['Passed'] > 0,
                f'{file}: missing test results or no passing tests for {project}')

        summary = root.find('{*}ResultSummary')
        require(summary is not None and summary.get('outcome') in {'Completed', 'Passed'},
                f'{file}: incomplete or unsuccessful test run')
        counters = summary.find('{*}Counters')
        require(counters is not None, f'{file}: missing test counters')
        passed = counts['Passed']
        skipped = sum(counts[outcome] for outcome in SKIP_OUTCOMES)
        expected = {'total': passed + skipped, 'executed': passed, 'passed': passed,
                    'failed': 0}
        for key, value in expected.items():
            require(counters.get(key) == str(value), f'{file}: inconsistent {key} counter')
        # VSTest 17.11 emits NotExecuted results with notExecuted=0 on CI #339.
        # Actual results, their identities and total/executed counters remain mandatory.
        require(counters.get('notExecuted') in {'0', str(skipped)},
                f'{file}: inconsistent notExecuted counter')
        for key in ('error', 'timeout', 'aborted', 'inconclusive', 'passedButRunAborted',
                    'notRunnable', 'disconnected', 'inProgress', 'pending'):
            require(counters.get(key, '0') == '0', f'{file}: nonzero {key} counter')
        require(not (cases & all_cases[project]), f'{file}: duplicate test result across shards')
        all_cases[project].update(cases)
        for key, ids in identities.items():
            all_identities[project][key].extend(ids)
        all_legacy_identities[project].extend(legacy_identities)
        previous_passed, previous_skipped = reports.get(project, (0, 0))
        reports[project] = (previous_passed + passed, previous_skipped + skipped)

    missing = [project for project in PROJECTS if project not in reports]
    require(not missing, 'Missing backend test reports: ' + ', '.join(missing))
    require(report_counts['BHome.IntegrationTests'] == integration_shards,
            'Missing integration shard report')
    for project, (passed, skipped) in reports.items():
        identities = all_identities[project]
        if discovery is not None:
            require_discovery(project, discovery[project], all_legacy_identities[project])
        if baseline is not None:
            require(project in baseline, f'{file}: missing baseline assembly')
            expected_identity = baseline[project]
            if 'cases' in expected_identity:
                require_inventory(project, expected_identity, identities)
            else:
                # Transitional read support for the original exact inventory.
                legacy = all_legacy_identities[project]
                require(len(legacy) == expected_identity['count']
                        and fingerprint(legacy) == expected_identity['identitySha256'],
                        f'{project}: test identity inventory changed; review baseline')
            print(f'{project}: testId fingerprint {fingerprint(list(all_cases[project]))}')
        if inventory is not None:
            inventory[project] = {
                'count': passed + skipped,
                'cases': {key: sorted(ids) for key, ids in sorted(identities.items())},
            }
    return reports


if __name__ == '__main__':
    try:
        parser = argparse.ArgumentParser(description=__doc__)
        parser.add_argument('trx_directory', type=Path)
        parser.add_argument('baseline', type=Path)
        parser.add_argument('--integration-shards', type=int, default=1,
                            help='Explicit experimental integration report count; defaults to one')
        parser.add_argument('--candidate', type=Path,
                            help='Write a NEW reviewable inventory only after the committed baseline passes')
        parser.add_argument('--discovery', type=Path,
                            help='Require current source-built discovery in addition to baseline identities')
        args = parser.parse_args()
        baseline = json.loads(args.baseline.read_text(encoding='utf-8'))
        inventory = {}
        for project, (passed, skipped) in verify(
                args.trx_directory, baseline, inventory, args.integration_shards,
                json.loads(args.discovery.read_text(encoding='utf-8')) if args.discovery else None).items():
            print(f'PASS: {project}: {passed} passed, {skipped} skipped')
        if args.candidate:
            with args.candidate.open('x', encoding='utf-8') as stream:
                json.dump(inventory, stream, indent=2, sort_keys=True)
                stream.write('\n')
    except (ValueError, OSError, ET.ParseError, IndexError, KeyError, TypeError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
