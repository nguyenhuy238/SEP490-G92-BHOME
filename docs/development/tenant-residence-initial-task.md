# Tenant residence task visibility

## Trace

- Tenant registration in BHome is a tracker for a process completed externally through VNeID; BHome does not submit an official registration.
- The Tenant task list must expose a resident row for an active main tenancy once its planned `ResidenceFrom` date has arrived, even before the Tenant records `ActualResidenceFrom`.
- Tenant updates the actual residence date through the existing residence task endpoint. Staff tracking remains scoped to assigned locations.

## Implementation

Residence task queries use `COALESCE(actual_residence_from, residence_from)` for the start-date gate and continue excluding residents with an actual move-out date. No contract, payment, signature, activation, or Tenant profile data is modified by this change.

## Verification

An integration regression test covers an active contract with no actual residence date and verifies that the Tenant can then record it. Running that test requires `BHOME_COMPACT24_TEST_ADMIN` configured for an authorized loopback PostgreSQL admin and disposable databases. Without it, the test is skipped by the existing test fixture guard.
