# Android workspace startup: missing ExpoCrypto

Scope: FE-02 / UC-01 mobile landing reliability and existing contract idempotency.
No backend contract, business policy, authorization or database change.

The workspace route statically imports the contract screens. Their top-level
`expo-crypto` imports tried to resolve `ExpoCrypto` in the installed Android runtime
and threw before the route finished loading. The route already had a default
export; the Router warning was a consequence of the failed import.

All three UUID consumers now use `lib/randomUUID.ts`, which delegates to Expo Core's
`uuid.v4()` instead of loading `expo-crypto`. Native failures propagate without an
insecure random fallback. Contract mutation-key caching, retry behavior and temporary
file naming remain unchanged. No dependencies or native project files were changed.

References checked: installed Expo 58.0.20 source and the
[SDK 58 Expo API](https://docs.expo.dev/versions/v58.0.0/sdk/expo/#uuid).

Verification: mobile typecheck and lint passed; 38 tests across UUID, contracts,
signing UI and Staff dashboard passed. Expo Go was force-stopped and reopened using
the existing Metro on port 8081; login and Staff preview dashboard rendered on
Pixel_5. A separate inspector probe of native UUID generation timed out, so it is
not counted as validation. Real contract writes/downloads and iOS were not tested.
