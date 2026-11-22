# Move-Out inspection draft (Compact24)

Scope: BF-02 / BF-04, UC-10–12 / UC-19, GBR-01–03 / GBR-18.
Source: actual Move-In `handover/draft` behavior, UC-19 physical inspection and
the user-approved Move-Out Staff workflow (21/11/2026).

The staff-facing Move-Out checklist supports **server-persisted partial work**,
separate from a final inspection and independent of its financial review. It
requires the corresponding OperationalTask to be started first. Move-Out has
**no PDF, no signature, no signer, and no required Tenant acknowledgment**.
Draft saving does not submit, close, approve, link evidence to a final report,
terminate a contract or change Room status.

## Routes

- `GET /api/v1/contracts/{id}/move-out/inspection-draft`: only currently
  authorized Staff who has started the Move-Out task and still owns it.
  Returns the persisted draft, or an empty **version 0** draft without writing
  anything. Never reveals an unsubmitted draft to Owner/Tenant/other Staff.
- `PATCH /api/v1/contracts/{id}/move-out/inspection-draft`: partial write.
  Header `Idempotency-Key: <uuid>` required. Body includes **version**.
  `PUT` on the same route is a compatible alias with identical merge behavior.
  Returns the new draft with an incremented version. Stale or concurrently
  modified versions return 409; replaying the same key and payload is idempotent.

Both endpoints require a currently active, authorized Staff-Location assignment,
`ContractMoveOut.Status=Approved`, a contract still `Active`, and
`OperationalTask.Status=InProgress` claimed by that Staff. Draft access starts
on or after `proposedDate`. A foreign Contract ID returns 404;
Owner/Tenant are forbidden; an unstarted/submitted/finished task returns 409.

### PATCH / PUT payload

```json
{
  "version": 0,
  "roomCondition": "Tường sạch, cửa hoạt động bình thường",
  "notes": "Đã kiểm tra tường và cửa",
  "roomChecks": [
    {
      "code": "walls_ceiling_floor",
      "status": "Passed",
      "notes": null,
      "evidenceIds": []
    }
  ]
}
```

All other fields are optional: `keysAndAccess`, `assets` (existing
`HandoverAssetInput[]`), `accessItems` (`HandoverAccessItem[]`),
`evidenceIds`, `keyEvidenceIds`, `electricityReadingId`,
`waterReadingId`, `inventoryToken`, `proposedCompensation`, and
`physicalItemEvidence`.

For one individual physical asset, Staff may PATCH with:

```json
{
  "version": 3,
  "physicalItemEvidence": [
    {
      "assetId": "11111111-1111-4111-8111-111111111111",
      "physicalAssetId": "22222222-2222-4222-8222-222222222222",
      "notes": "Trầy xước mặt bàn",
      "evidenceIds": ["33333333-3333-4333-8333-333333333333"]
    }
  ]
}
```

IDs above are illustrative only. Partial PATCH merges by the composite
`(assetId, physicalAssetId)` and does not erase other items. Each item can
reference up to five private photos owned by the same Staff for the same
contract. Photo IDs cannot overlap with general, room-check, group-asset,
key or other physical-item evidence. On explicit final submission the backend
verifies and hashes the images and links them to the immutable inspection JSON.

Move-Out validation is independent of Move-In: all seven room checks must be
`Passed` or `Issue` (Issue needs a reason); photos are optional in both cases.
Keys require only the returned count, including zero; notes and photos are
optional even when fewer keys were returned. Quantity-tracked assets record
the current count and condition; an Issue or a discrepancy against a confirmed
opening count requires a reason, but photos remain optional. Good/worn/damaged
splits and the separate handed-over count remain unknown unless explicitly
observed. Final general `notes` and `evidenceIds` are optional. Photo privacy,
hashing, duplicate checks and immutable final inspection remain enforced.

For **per-item auto-save**, send only the edited `roomChecks: [item]`
or `assets: [item]`; the Backend merges RoomChecks by `code` and assets by
`id` while retaining other saved items. Null/omitted fields retain their
previous value. An empty string clears text, empty `evidenceIds` or
`keyEvidenceIds` clears that collection, `Guid.Empty` explicitly clears
electricity/water selection. A response exposes `version`, `contractId`,
`status: "Draft"`, the full merged values and `updatedAt`.

The Backend validates an asset ID against the current Room inventory/baseline,
physical observation IDs against its asset group, checklist code against the
seven approved Room checks, and every attachment ID against a private
ContractInspectionEvidence uploaded by the *same Staff* for the *same Contract*
and still unlinked to a final report. It also checks the inventory token when
asset groups are edited and verifies submitted final-reading IDs. Stale
inventory, another Staff's evidence, foreign assets, duplicate evidence across
sections, over-limit files, and already-linked photos cannot be saved.

Saving a draft is not a substitute for
`POST /api/v1/contracts/{id}/move-out/inspection`, which still accepts the
existing complete `InspectionInput` and performs all final readings, baseline,
checklist, evidence, date, status and financial-safety checks. The UI must send
the **complete fields** from the saved draft on explicit final submission.
That operation atomically advances the OperationalTask to
`PendingVerification`. When Owner requires reinspection, the prior immutable
final inspection keeps its evidence; the mutable draft is reset to an empty
next-version draft, and Staff can save new observations with new photos.
Owner confirmation makes the completed draft inaccessible for further writes.

## Storage and testing

Compact24 stores the mutable state at `contracts.move_out.inspectionDraft`
as a sibling of `current` and `inspections`, with an atomic
`WHERE version=expectedVersion` comparison and updates under the same
contract/Room/Location transaction locks. `contracts.handover.current` and
previous Move-Out final inspections are untouched. No migration or new
database table is needed. The archived legacy schema has no draft persistence;
its Move-Out final-inspection API remains unchanged.

The opening quantity/condition is only comparable when confirmed historical
Move-In data exists for the individual asset. Unknown opening quantities stay
unknown (`missingQuantity=null`), not an invented zero or tenant liability.
Owner uses `GET /move-out/inspections` and versioned
`POST /move-out/inspection-review` to review observations; no Tenant response
or signer is required. `POST /move-out/complete` does not render a PDF.
Historical MoveOutReport PDFs, if any, stay readable for audit but no new
MoveOutReport is generated. Financial settlement is a separate Owner action.

Focused PostgreSQL tests: `Compact24ContractRegressionTests.MoveOutDraft`
and `Compact24ContractRegressionTests.MoveOut`. Both use isolated disposable
Compact24 databases through `BHOME_COMPACT24_TEST_ADMIN`. They verify
staff-only access, task-start gate, per-item persistence across calls, stale
versions and idempotency, invalid IDs, final submission and reinspection reset.
