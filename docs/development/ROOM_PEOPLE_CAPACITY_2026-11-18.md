# Limit onboarding occupants to database room capacity

The family roster allowed unlimited local rows because the add button only enforced Individual mode. Backend persistence already checks overlapping occupants against room capacity, but the reception screen did not apply that limit before identity capture.

## Behavior

- `OnboardingScreen` reads the selected room's `capacity` and `remainingCapacity` from the existing capture scope. The roster limit is the smaller value; missing capacity blocks progression instead of permitting unlimited additions.
- `OnboardingPeopleStep` displays current count/limit, explains the available places and disables adding at the limit. Individual mode still permits one person.
- Parent callbacks enforce the same limit, including the functional state update. Identity capture and contract progression cannot continue with an oversized roster.
- Existing draft rows are retained; no confirmed identities or database resident records are silently deleted.
- `MainDraftService.PrepareAsync` and direct `ContractService.CreateAsync` reject more residents than the database room capacity with `room_capacity_exceeded`. The existing transactional repository check still accounts for other active contracts and overlapping dates before persistence/activation.
- Shared clients translate that error and clarify the existing room-conflict message.

No database/schema, payment or signing changes.

## Validation

- 41 Mobile onboarding tests passed, including two-place family limit, removing/replacing a draft member and a two-person room with only one remaining place.
- 153 Contracts application tests passed, including rejecting three people against a room capacity of two without creating contract/operation rows.
- 1 isolated local PostgreSQL API integration test passed: preparation rejects three residents using the room capacity read from database.
- Mobile TypeScript and focused ESLint passed. UI detector reported no findings.
- Rebuilt and restarted the local API; existing HTTPS tunnels retained. Verification logs are ignored under `.tools/develop-sync/room-capacity-*.log`.
