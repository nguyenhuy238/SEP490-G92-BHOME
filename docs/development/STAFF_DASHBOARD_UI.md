# Staff mobile dashboard

User request, 31/10/2026: redesign the signed-in Staff landing screen according to
the supplied image and the attached "Redesign BHOME Staff Mobile Dashboard" brief.
Use React Native Paper/MD3, ten centered feature cards in five two-column groups,
navy `#193452`, background `#F5F7FB` and exactly Home/Profile bottom tabs.

Scope: FE-02 / UC-01 authentication landing, Staff operations entry points and the
existing role/location boundary (GBR-01/02/13). No business rules, API contracts,
data-access permissions or mutations are added by this presentation change. The UI
entry points cover existing UC-09/13/15/16/17/19/20 operational routes; this does
not assert that every destination has a complete backend adapter.

- `StaffFeatureCard` uses existing Paper icons, ripple and theme typography. Icons
  are 26 inside 48x48 pastel containers; card radius is 18, padding 12 and column
  gap 12, reduced in response to the follow-up request for smaller cards. Titles
  and descriptions are centered without arrows or truncation. Reserved empty text
  rows were removed; cards share the height of the tallest item in each row and
  grow naturally with larger system text. Content can scroll vertically.
- `StaffDashboard` groups ten shortcuts into reception/contracts, work/schedule,
  meters/handover, incidents/maintenance and debt/notifications. The handover card
  offers both move-in and move-out destinations. The contract card opens the
  existing lifecycle list (`signing`) where authorized actions remain unchanged.
  My Work and Incident Handling reuse the same assigned-work route.
- The existing Expo Router workspace route now renders `staff-home` for signed-in
  Staff. Existing destination guards and unavailable-service states remain active.
- The Staff shell uses a compact navy header, notification shortcut and Home/Profile
  tabs. Its status bar uses light icons; bottom safe-area padding stays inside the
  white navigation surface. Owner and Tenant retain their existing palette and tabs.
- Only development preview shows sample name, shift and counts. Authenticated
  accounts show an explicit unavailable summary until a Staff overview API is wired.
  The current session contract has no display name or assigned-location label.
- No mobile send-notification workflow existed. The Staff-only `send-notification`
  workspace key renders a clear "Chức năng chưa triển khai" state and links to the
  existing inbox. It has no send form, API call, success state or sample broadcast.
  Inbox and other unfinished live destinations retain existing unavailable states.
- Functional acceptance: each card opens its intended existing route; handover can
  be selected or dismissed; authenticated accounts never receive sample statistics;
  non-Staff access continues through the existing `canOpenScreen` guard.

This UI change does not connect unfinished destination APIs. The existing real-data
fallback is preserved rather than showing synthetic operations after login.

Verification, updated for the ten-card redesign:

- Mobile typecheck and lint passed.
- The mobile test run reported 167 passed and 6 existing Expo startup failures:
  this machine runs Node 24 while the launcher requires Node 22. The attempted
  `--exclude '**/expoStartup.test.ts'` did not exclude that file under this workspace
  configuration, so this result includes it. Targeted dashboard/navigation/UUID/
  signing tests were also run separately.
- The Pixel_5 Staff preview was visually inspected at its normal width and at
  320dp with font scale 1.3. The last row could be scrolled fully above navigation;
  sending-notification navigation reached the explicit unavailable screen. Emulator
  display size and font settings were restored after testing.
- `expo export --platform ios --output-dir ../../.tools/mobile-staff-ios` passed.
  This checks bundling, not actual iOS layout or native execution.

Not verified: iOS simulator/device, a real authenticated backend session, live Staff
overview statistics, actual notification delivery or unfinished destination APIs.
