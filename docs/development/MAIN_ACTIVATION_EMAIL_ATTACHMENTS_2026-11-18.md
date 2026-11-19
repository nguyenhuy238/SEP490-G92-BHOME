# Main activation: signed contract and active Tenant account email

## Diagnosis

Local P.102 Main contract was active from 17:50 on 18/11/2026 (Asia/Bangkok). Its Tenant account was active and awaiting password setup. The original `TenantInvitation` outbox delivery was `Sent` with an SMTP acknowledgement at 17:50; this indicates provider acceptance, not Inbox delivery. The address matched the accepted signing email and resident profile.

The Main account-setup email already included activation details, verified payment information and a one-time password setup link, but did not carry a signed PDF attachment. The separate activation email is intentionally suppressed for an unconfirmed new Tenant account because setup and activation are combined in that first email.

## Changes

- `NotificationEmailContent.MainAttachmentsAsync`: load only the active non-demo Main contract belonging to the recipient. Use the immutable final internal acceptance PDF, or the final verified signing PDF when both parties signed through the other supported signing flow. Check the contract snapshot, parties, storage key prefix, PDF header/size and SHA-256. Missing storage/files retry; invalid evidence fails closed. Never generate a replacement PDF.
- `AuthenticationEmailDelivery.Content` carries optional attachments. New Tenant account invitations combine the signed PDF, activation details and existing one-time setup link.
- `NotificationChannelWorker` forwards authentication attachments and also attaches the PDF to ordinary Main activation emails for existing confirmed Tenant accounts. Existing email delivery leases, idempotency and unknown SMTP outcome handling remain intact.
- Notification test fixtures now supply immutable synthetic signing evidence. Integration coverage checks a new-account email with its action URL and exact attachment; an existing-account email; repeat execution; missing/altered/cross-contract documents; and wrong-recipient access.

No schema, signing evidence, account activation, payment, or Holding email behavior changed.

## Verification and authorized recovery

- 114 notification/authentication/email transport tests passed.
- 5 focused Main attachment tests passed after the local Docker/PostgreSQL service was restored.
- API rebuilt and restarted on local PostgreSQL; public API readiness and password setup page returned HTTP 200.
- User explicitly approved sending a new email to the address already saved for P.102. A single recovery intent reuses the original approved invitation payload through the existing `post-activation-account-invitation` job. Stable key: `main-activation-email-recovery:4a8652f1-efcd-4bbf-b112-a2c670679939:2026-11-18-pdf`.
- Recovery job completed once. New TenantInvitation outbox `021bcad6-b807-49fe-b07e-b021bf007ac6` reached `Sent` with SMTP acknowledgement at 20:58 on 18/11/2026 (Asia/Bangkok). New setup grant expires at 21:13. No raw tokens or signed document contents were logged.
- Earlier `Sent` email was retained. SMTP acknowledgement does not prove delivery to Inbox.
- The old quick-tunnel processes were no longer running after the runtime interruption. Fresh API/web HTTPS origins were configured only in `.env` and matching development public URL settings; Mobile's local API origin was synchronized. Database remains local. See ignored `.tools/cloudflare/session-api-url.txt`, `session-web-url.txt` and `sepay-webhook-url.txt` for current URLs.

Local verification logs: `.tools/develop-sync/main-activation-email-tests.log` and `main-activation-attachments-tests.log`.
