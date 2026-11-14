# JOB-09 fixture after database reset (13/11/2026)

Traceability: BF-05 / UC-17 / UC-20 / JOB-09 / GBR-18.

Location: BHOME JOB09 TEST, ID fa090013-0000-4000-8000-000000000010.
Room J09-101 is Occupied with an Active synthetic development Main Contract
(01/11/2026–31/10/2027, 3,000,000 VND/month).
Dedicated accounts: staff.job09@example.invalid and tenant.job09@example.invalid.
Staff assignment: 01/10/2026–01/11/2027. Existing Owner and Chain are reused.
Passwords are in Git-ignored .tools/job09/credentials.json; existing passwords are preserved.

Two active digital meters: JOB09-101-0 (electricity), JOB09-101-1 (water).
No tasks, readings, automation plans or invoices were seeded.
Owner must next create Initial tasks; Staff uploads evidence and confirms readings.
The contract is test data, not evidence of real payment, signing or confirmed handover.

Executed: tooling build succeeded with zero warnings/errors; live Neon read-back
confirmed room occupancy, Active contract linked to dedicated Tenant, effective Staff
assignment, two meters, zero readings and zero tasks. No automatic job was run.

Owner Web Initial task entry is available at `/meters`. Select the Location and Room,
then choose “Giao nhiệm vụ ghi chỉ số ban đầu”. Select each meter and its reading date.
The form displays current Staff responsibility using existing Location assignments.
It submits `POST /api/v1/capture/meter-tasks` with `purpose=0` and `billingPeriod=null`.
Staff access follows the existing backend Location assignment rules.
Acceptance checks cover required Location/Room/date, room-scoped meter options,
Initial payload, backend conflict feedback and unavailable Staff assignment.
