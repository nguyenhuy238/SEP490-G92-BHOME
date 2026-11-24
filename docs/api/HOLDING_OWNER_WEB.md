# Holding Owner Web integration

UC-14/15, GBR-04 and verified bank allocation: reuse the existing Holding creation, approval, activation, cancellation, conversion and holding-deposit endpoints. Owner Web uses the current contract forms and signing dialogs with kind-specific actions. Holding never exposes Main activate/renew/move-out actions. Activation-readiness now dispatches to the existing HoldingReadiness policy for Holding records; no readiness invariant is relaxed.

Deposit allocation uses payment-transactions/{id}/allocate-holding-deposit, the authenticated human verification flag and the Holding representative's Tenant account. The command key is retained after an uncertain response. Pending/excess/review outcomes remain server-driven. Contract history, expiry and bank ledger remain unchanged.

Production document/provider approval guards remain enforced. The development signing mode is not legal signature evidence for production. No new endpoint or schema migration is introduced by this stage.

## Holding signing document

BF-03, UC-13/14/15, GBR-04 and DBR-02. New Holding signing documents use the
Word template derived from `docs/development/hop-dong-dat-coc-thue-tro.doc`.
The backend fills the registered Owner profile for the location, staff-confirmed
Tenant identity and the saved room, rental term, price, deposit and expiry. The
location needs an effective Owner contract profile for the designated signer.
Fields unavailable in BHOME, such as the property certificate number, are omitted.

Article 2.1 states that the verified Holding deposit is applied to the Main
security deposit. Article 4 is preserved from the Owner-approved template.
Payment verification, accounting and cancellation still follow the existing
workflows. No automatic compensation is triggered by generating the document.

The first generated PDF is stored privately as the canonical preview for its
contract snapshot. The Owner preview and Tenant invitation use those same bytes.
An outstanding invitation or signing evidence from before the template change
retains its reviewed document. Tenant receives the existing signing invitation.
Owner receives an in-app notice and an email notification to the confirmed
address when the email channel is available. The Owner opens the contract using
the authenticated portal. Email configuration and recipient restrictions apply.

The release API image uses its installed LibreOffice for DOCX-to-PDF conversion.
If the PDF source or signing email configuration is unavailable before delivery,
Mobile shows the specific blocker. An uncertain response after dispatch still
requires refreshing signing status before retrying.

For an older Holding invitation with no stored preview, the Owner preview
reuses the exact PDF from the invitation. The signing workflow keeps the
reviewed terms and places the Tenant's drawn signature in the PDF's Tenant box
when the source has one. If the Owner signs first, Tenant acceptance is appended
as a PDF revision that preserves the Owner signature. Holding and Main
confirmation emails use the stored final PDF once their existing activation and
recipient checks pass.
