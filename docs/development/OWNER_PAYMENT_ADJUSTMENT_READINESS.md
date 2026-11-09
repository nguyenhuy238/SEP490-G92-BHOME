# Owner Payment, Adjustment and Debt readiness

UC-22/23/24/25, GBR-10: existing `OwnerInvoicePaymentPanel`, `ReconcileTransfer` and `OwnerAdjustmentList` remain the authorized workflows. They use persisted bank transactions, payer lookup, explicit human verification, stable retry keys, Owner adjustment decisions and server balances. Holding allocation is integrated in the Holding contract panel.

Payment history now has independent server pagination, including the Debt view. Scope changes reset its page, and refresh invalidates financial queries without changing money. History no longer stops at the invoice list's current page. Existing payment/adjustment component regressions cover duplicate submission, uncertain retry, paid/partial/excess results and decision conflicts.

Automatic bank reconciliation still needs a configured provider, credentials and verified callback contract (CAP02). Manual statement verification is available; images alone do not prove settlement. Reminder policy configuration is integrated under Notifications; no unapproved automatic cadence or allocation priority is added. Full real-bank and cross-channel E2E has not run.
