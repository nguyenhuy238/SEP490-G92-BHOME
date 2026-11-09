# Owner public content administration

Traceability: UC-37/38, GBR-17. API mode uses existing Location/Room public-content GET/PUT, PNG/JPEG upload/delete and publish/unpublish APIs. Forms send only the approved public fields: summary/description, amenities, static contacts and indicative price. Name, address, occupancy/vacancy and capacity are read-only dependencies. No Guest data capture, reservation, payment or contract workflow is added.

New authenticated previews: `GET /api/v1/public-content/locations/{id}/photos/{index}` and the equivalent `rooms` path. Both require the existing PublicContent.Publish permission and private no-store response; they reuse `IOperationsRepository.PublicPhotoAsync(..., publishedOnly: false)`. Object keys are never returned. The anonymous `/api/v1/public/.../photos/...` still requires published content, including the parent Location for Rooms. Existing anonymous responses cache for 60 seconds; unpublishing does not purge browser/proxy caches.

Owner preview shows only public fields and loads saved photos through authenticated blobs. Publish requires saved form data. Upload/delete/publish are explicitly confirmed. The existing public-content writes do not have version/replay contracts; concurrent edits and uncertain upload results require checking current server content. No schema changes.

The separate Public Web client remains an EXTERNAL_TEAM_DEPENDENCY. Owner administration and the anonymous information API are implemented; a complete Guest website and cross-channel E2E are not claimed.
