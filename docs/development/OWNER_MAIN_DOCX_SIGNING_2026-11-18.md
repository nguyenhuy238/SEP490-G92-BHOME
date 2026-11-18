# Owner PDF preview and supplied Main tenancy template

## Requested behavior

- Owner reviews and signs; Staff sends the Tenant invitation from Mobile. Owner Web no longer exposes recipient editing or invitation sending in the internal signing panel.
- Owner can open the complete PDF before signing and the latest signed PDF after either party signs.
- Main contracts use `docs/mau-hop-dong-thue-nha-tro-ngan-gon.docx`: retain its title, clauses and original field structure; fill verified identity, configured lessor, room, dates, agreed charges, rent and contractual deposit from existing data.
- Tenant (B) signs on the left and Owner (A) on the right. Reserve separate areas, fit the signature image above its caption and reject placements overlapping the other party's reserved area.
- User explicitly chose to retain P.102's existing signed PDF. Never rebuild that evidence. Existing signed/accepted contracts and live invitations without the new canonical source keep their original document flow.

## Implementation

`MainDraftRenderer` still edits the embedded original DOCX. The signature block is a two-column table with reserved signing space. Actual signing copies retain the original title; development demo documents keep their test notice. Generated policy UUID/version/hash headings are omitted from displayed extra terms without changing stored terms or their snapshot.

`MainTemplateSignatureSlots` locates the actual headings in converted PDF pages and records Tenant/Owner coordinates. `InternalAcceptanceRenderer` places the Tenant drawing inside the original signature area only for this new source template; legacy documents retain the previous evidence-page behavior. Owner signing preserves the existing incremental PDF signature flow.

`ContractSigningDocumentSource` uses an existing canonical DOCX preview when available. For unsigned Main contracts created through the older conversion path, it creates and persists that source once under the existing snapshot, verifies its hash on reads and reuses exactly those bytes for preview and invitation. It does not create replacement sources for existing signing evidence or unrevoked live/accepted invitations. Production template approval gates remain enforced. No schema changes.

`OwnerContractPreview` lazily fetches an authorized PDF and revokes its local blob URL on cleanup. It uses the signed-document endpoint after signing and the canonical preview endpoint beforehand. `InternalSigningPanel` removes invitation sending/editing; `SignaturePlacementPicker` separates image and caption rows.

## Data and runtime

- Use the local PostgreSQL configuration and existing encrypted identity protection.
- Existing main draft input supplies phone/CCCD issuing place when present. Older converted holding profiles may lack these fields; leave absent data blank rather than inventing it.
- Local converter: `MainDraft__LibreOfficeContainerImage=bhome/contract-converter:local`. Original DOCX file remains unchanged.
- No real invitation emails were sent for verification; integration fixtures use synthetic identities, intercepted delivery and isolated disposable local databases.

## Validation

- Owner signing/preview UI: 15 tests passed; TypeScript and lint passed, with an existing test-only React warning in `DigitalSigningPage.test.tsx`.
- Owner production build passed; existing large-chunk advisory remains.
- Contracts application unit suite: 152 tests passed.
- Real DOCX conversion and visible-signature regression tests: 6 passed. Synthetic PDF page renders inspected for Vietnamese text, original clauses, filled fields and separate signature areas.
- Database workflow checks: 5 passed, covering direct Main, Holding-to-Main and reviewed draft release. The conversion test checks byte equality between Owner preview and Tenant signing document and checks the invitation's SHA-256.
- UI detector: zero primary findings; one advisory for the existing small caption inside the scaled PDF preview.
- Runtime local API, public API readiness, Owner Web and Mobile bundle returned HTTP 200 after restart.

See `.tools/develop-sync/owner-docx-*.log` for local verification output (ignored runtime artifacts).
