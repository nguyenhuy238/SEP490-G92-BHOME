# Holding Owner Web integration

UC-14/15, GBR-04 and verified bank allocation: reuse the existing Holding creation, approval, activation, cancellation, conversion and holding-deposit endpoints. Owner Web uses the current contract forms and signing dialogs with kind-specific actions. Holding never exposes Main activate/renew/move-out actions. Activation-readiness now dispatches to the existing HoldingReadiness policy for Holding records; no readiness invariant is relaxed.

Deposit allocation uses payment-transactions/{id}/allocate-holding-deposit, the authenticated human verification flag and the Holding representative's Tenant account. The command key is retained after an uncertain response. Pending/excess/review outcomes remain server-driven. Contract history, expiry and bank ledger remain unchanged.

Production document/provider approval guards remain enforced. The development signing mode is not legal signature evidence for production. No new endpoint or schema migration is introduced by this stage.
