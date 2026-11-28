#!/usr/bin/env python3
"""Require executed passing regression cases before releasing a branch build."""
import sys
import xml.etree.ElementTree as ET
from pathlib import Path


REQUIRED = {
    'BHome.Infrastructure.UnitTests.HoldingTestScopeTests.': 7,
    'BHome.Infrastructure.UnitTests.BillingAutomationRuntimeTests.': 9,
    'BHome.Infrastructure.UnitTests.PaymentRuntimeModeTests.': 8,
    'BHome.Infrastructure.UnitTests.DemoClockGuardTests.': 40,
    'BHome.Infrastructure.UnitTests.ContractWorkflowDemoDeploymentTests.': 7,
    'BHome.Application.UnitTests.PropertyManagement.RoomInventoryReviewServiceTests.': 1,
    'BHome.IntegrationTests.Compact24.SePayIntegrationTests.InvoiceInstructionsUseRegisteredBhMemoAndFailClosedWhenSePayAccountDrifts': 3,
    'BHome.IntegrationTests.Compact24.SePayIntegrationTests.MainInitialQrUsesOneReceiptForDepositAndRentFeesAndRejectsPartialOrDuplicateEffects': 2,
    'BHome.IntegrationTests.Compact24.SePayIntegrationTests.ModeSwitchPreservesOldQrAndAccountsAndReconcilesBothModes': 1,
    'BHome.IntegrationTests.Compact24.SePayIntegrationTests.ModeSpecificWebhookRejectsOtherSecretAndForeignInstanceWithoutFinancialEffect': 1,
    'BHome.IntegrationTests.Compact24.SePayIntegrationTests.BothPollingJobsKeepIndependentCheckpointsAndDeduplicateAfterOwnerSwitchesMode': 1,
    'BHome.IntegrationTests.Compact24.SePayIntegrationTests.PreUpgradeFinalInvoiceKeepsItsModeAndBankBeforeItsFirstSePayQr': 1,
    'BHome.IntegrationTests.Compact24.SePayIntegrationTests.LegacyCodeRequiresUniqueDeploymentRoutingAndCanResumeWithoutChangingItsCodeOrMode': 1,
    'BHome.Application.UnitTests.Contracts.ContractPaymentModeTests.DepositOffsetUsesSameBusinessRulesAcrossReceivingModes': 4,
    'BHome.Application.UnitTests.Contracts.ContractPaymentModeTests.NewSettlementUsesSelectedReceivingModeAndReplayPreservesItsIssuedMode': 4,
    'BHome.IntegrationTests.Compact24.SePayIntegrationTests.OwnerCanSelectUnconfiguredLiveAndSaveEncryptedCredentialsWithoutRestart': 1,
    'BHome.IntegrationTests.Compact24.SePayIntegrationTests.OwnerCanEnableLiveConnectionWhenAllServerSePayProfilesAreDisabled': 1,
    'BHome.IntegrationTests.Compact24.SePayIntegrationTests.OwnerManagedConnectionRetainsLegacyLocationBindingForAlreadyIssuedQr': 1,
    'BHome.IntegrationTests.Compact24.SePayIntegrationTests.OwnerConnectionRejectsTenantOverpostingMissingConfirmationAndSharedModeSecrets': 1,
    'BHome.IntegrationTests.Compact24.SePayIntegrationTests.AmbiguousLegacyObligationCannotReceiveAutomaticCreditFromEitherMode': 1,
    'BHome.IntegrationTests.Compact24.Compact24OwnerSetupTests.TenantSessionSignatureCompletesOwnerSignedMoveInWithoutOtpAndCannotBeReplayedOrSpoofed': 2,
    'BHome.IntegrationTests.Compact24.Compact24OwnerSetupTests.StaffSubmitOwnerSignedPdfAndTenantOtpProduceVerifiedTwoSignatureHandover': 2,
    'BHome.IntegrationTests.Compact24.Compact24OwnerSetupTests.StaffCanSubmitFourCompletedSectionsWithRoomIssueAndMissingInventoryWithoutDraftAssets': 1,
    'BHome.IntegrationTests.Compact24.Compact24OwnerSetupTests.OwnerQuickCreateUsesExistingRoomAndRealConfigurationWithoutDuplicateContract': 1,
    'BHome.IntegrationTests.Compact24.Compact24BillingManualActionsTests.': 2,
    'BHome.IntegrationTests.Compact24.MainDraftDocumentRegressionTests.DemoTemplateIsAvailableWithRealPersistence': 3,
}


def verify(directory):
    results = []
    for file in Path(directory).rglob('*.trx'):
        for entry in ET.parse(file).getroot().iter():
            if entry.tag.rsplit('}', 1)[-1] == 'UnitTestResult':
                results.append((entry.get('testName', ''), entry.get('outcome', '')))
    failures = []
    for prefix, minimum in REQUIRED.items():
        matches = [(name, outcome) for name, outcome in results if name.startswith(prefix)]
        if len({name for name, _ in matches}) < minimum or any(outcome != 'Passed' for _, outcome in matches):
            failures.append(prefix)
    if failures:
        raise ValueError('Required regression cases missing, skipped or failing: ' + ', '.join(failures))
    return len(REQUIRED)


if __name__ == '__main__':
    try:
        count = verify(sys.argv[1])
        print(f'PASS: {count} required Staging regression groups executed successfully')
    except (ValueError, OSError, ET.ParseError, IndexError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
