# Owner Resident administration

Traceability: UC-13, GBR-02/13; Owner Web implementation stage 3. Reuses the current Compact24 residents, users, rooms, contract_residents and append-only audit storage. No schema change.

- GET `/api/v1/residents`: Owner-only paginated safe summaries. Query: locationId, roomId, search (display label only), verificationStatus (0..2), page, pageSize (1..100). Response: items/page/pageSize/totalCount.
- GET `/api/v1/residents/{id}`: adds tenancy history and representative/co-occupant roles. Linked-account email/phone are read-only. No raw ID, encrypted envelope, HMAC, storage keys or identity photos are returned.
- PUT `/api/v1/residents/{id}/workspace-label`: displayLabel, version, reason. Row lock and opaque version reject stale updates with 409. Only the non-sensitive workspace label changes; confirmed identity, room, account and contract membership do not.

Creation, account linking and invitations continue to use the existing capture/contracts/auth APIs. Identity confirmation remains Staff-only. Identity correction/contact-account editing beyond these contracts requires an approved workflow; this endpoint cannot change identity or account security fields.

Regression: new residents derive the identity scope from the single active deployment Owner, not the creator. ResidentCreated audit retains the actual creator. Confirmation locks the deployment Owner for cross-creator deduplication, checks configured HMAC key versions for existing legacy scopes, and retains the authenticated encryption scope of already verified legacy envelopes. No identity data migration is run.
