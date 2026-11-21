# Owner billing integration

UC-20/21, GBR-07/08/09 and JOB-09/10: reuse the existing meter assignment, invoice and billing automation panels. Meter list now forwards Location, Room, status, due date and page to `MeterTaskQuery`. The existing endpoint returns 100 items per page without a count; next-page navigation is available for full pages and UUID lookup remains available. Confirmed-reading evidence uses the authenticated download endpoint. Owner has no OCR confirmation action.

The Invoice list forwards the supported Room filter to the backend before pagination. The draft editor remains separate. Existing versioned refresh/finalize actions, missing-input blockers and automation exception/retry UI are preserved. Invoice uniqueness remains Room + billing period. Location/status/period filters for the draft Invoice list are not supported by its current query contract; the financial Payment/Debt list supports those filters for finalized invoices.

No billing policy UI, formulas, schema or Staff confirmation permission was changed. Cross-channel capture-to-invoice E2E remains to be executed.
