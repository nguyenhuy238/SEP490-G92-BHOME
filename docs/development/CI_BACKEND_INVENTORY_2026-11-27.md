# Backend CI inventory reconciliation — 2026-11-27

Evidence: GitHub Actions run 45935744085, job 140298432913, artifact
backend-trx-attempt-1 (15171735962), commit caf5f671d6e462e3ddfc9b5297f4ec2dcad923b1.
The full backend test command passed; only the retained test inventory check failed.
The artifact contains all five TRX reports and current source-built discovery.

Reviewed obsolete identities against historical TRX and the source diff:

| Previous test method                                                                              | Rows | Current replacement / reason                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------- | ---: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ContractServiceTests.OwnerCreatesApprovedMoveOutWithUnscheduledLocationWorkAtAnyLeaseDate         |    3 | OwnerCannotInitiateOrdinaryMoveOutAtAnyFutureLeaseDate (same three dates), RoomMoveOutRequiresEveryTenantBeforeOwnerApproval; ordinary owner initiation was replaced by unanimous tenant approval.                                                                                                     |
| ContractServiceTests.OwnerCanReopenRejectedTenantRequestWithoutLosingImmediateStaffTask           |    1 | TenantCanReopenRejectedRequestAndOwnerCanApprove; tenant reopens, owner approves.                                                                                                                                                                                                                      |
| MoveOutProposalSettlementRulesTests.BankTransferNeedsAtMostOneRemainingReceivable                 |    7 | VerifiedCompletionAcceptsEachQuotedPayableButNeverAnUnrelatedReceivable; the single remaining receivable restriction was replaced by multiple quoted payable receivables.                                                                                                                              |
| MoveOutProposalSettlementRulesTests.InvalidDepositOrChargeNeverAllowsAutomaticAllocation          |    1 | The removed OnePayableAfterDeposit predicate is no longer the allocation policy; the replacement test checks quoted IDs, covered/unrelated IDs, settled state and legacy single-payable compatibility. This inventory change does not claim equivalent coverage of all former invalid-input scenarios. |
| ContractLifecycleApiTests.OwnerOpensMoveOutImmediatelyForLocationWithoutStaffAssignmentOrSchedule |    3 | OwnerApprovesTenantMoveOutForLocationWithoutStaffAssignmentOrSchedule (0, 10, 20 days); explicit tenant request precedes owner approval.                                                                                                                                                               |
| Compact24OwnerSetupTests.TenantMoveOutRequestNotifiesOwnerAndAssignedStaffOnce                    |    1 | TenantMoveOutRequestNotifiesOwnerOnceWithoutPrematureStaffAssignment; staff work is not assigned before approval.                                                                                                                                                                                      |

Exactly 16 old identities are superseded; 31 passing new identities are recorded.
All other old IDs are retained. No test source, verifier, skip allowlist, workflow,
or production behavior is changed by this inventory reconciliation.

| Assembly       | Passed | Allowed skipped |
| -------------- | -----: | --------------: |
| Application    |    775 |               0 |
| Domain         |    115 |               0 |
| Infrastructure |    252 |               0 |
| Integration    |   1565 |              32 |
| DigitalSigning |     41 |               0 |

Re-run the unchanged Verify-BackendTrx.py against the downloaded artifact and its
discovery with the reviewed inventory. The PR still requires independent review
and a new CI run on the inventory commit.
