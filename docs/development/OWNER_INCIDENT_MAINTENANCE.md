# Owner incident and maintenance workspace

Traceability: BF-07, UC-26..30, GBR-11/12. API mode now uses existing Incident and WorkOrder controllers instead of demo repositories. The shared workspace preserves the Owner page layout, table, cards, confirmation/error UI and authenticated transport.

Supported: server filters/pagination, classification, rejection/duplicate/cancellation, assignment to the currently responsible Staff, private evidence downloads, Owner direct completion with uploaded images, emergency activity/cost decisions, proposal approval/rejection, reassign/cancel, verify/rework, costs and maintenance history. Every decision carries the reviewed version and stable retry key. Staff report submission, acknowledgement, inspection/proposal, start/progress/submit remain Mobile operations. Resolution and expense posting are backend decisions.

Reads use IncidentContracts DTOs, including actor and proposal/verification stamps; writes use exact controller fields and numeric AssetStatus. Images are validated by the backend (5 images, 5 MB each); the browser also restricts MIME/size. Existing Compact24 persistence and workflow guards are unchanged.

Owner can append an authorized emergency response with evidence and optional cost, and decide pending emergency costs. Staff acknowledgement remains separate. Public emergency guidance is displayed. No real MinIO, Mobile push or multi-client E2E success is implied by component tests or memory-storage integration fixtures.
