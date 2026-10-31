# BHOME Mobile - AI Agent Rules

## 1. Scope
This application is built with React Native.

Supported roles:
- Owner
- Staff
- Tenant

Follow the root AGENTS.md rules.

## 2. Architecture
Respect the existing project structure.

Typical responsibilities:
- navigation/: Navigation configuration and guards.
- screens/: Screen-level UI and interactions.
- components/: Reusable UI components.
- services/: Backend API communication.
- hooks/: Reusable React logic, if present.
- types/: TypeScript contracts, if present.

Do not move or rename existing folders unnecessarily.

## 3. Coding Rules
- Use TypeScript conventions if the project uses TypeScript.
- Prefer functional components and React Hooks.
- Keep components focused and reusable.
- Separate UI rendering from API communication.
- Avoid duplicated business logic.
- Follow existing naming, formatting and import conventions.
- Do not introduce a new state-management library unless required.
- Avoid unnecessary re-renders and expensive computations.

## 4. Navigation
- Follow the existing navigation library and patterns.
- Restrict navigation according to authenticated roles.
- Prevent unauthorized access to protected screens.
- Handle expired sessions and logout correctly.
- Preserve existing navigation flows.

## 5. API Integration
- Centralize API calls in the existing service layer.
- Use configured environment-specific API URLs.
- Follow backend request and response contracts.
- Handle loading, error, empty and success states.
- Handle 401, 403 and validation errors.
- Prevent unintended duplicate requests.

## 6. UI/UX
- Follow the existing design system.
- Support different mobile screen sizes.
- Respect safe areas and keyboard behavior.
- Provide clear form validation messages.
- Show loading indicators for asynchronous operations.
- Provide useful empty and error states.
- Ensure buttons and touch targets are accessible.
- Do not hardcode repeated styles without reason.

## 7. Security
- Never store tokens in unencrypted AsyncStorage.
- Use the project's approved secure storage mechanism.
- Never log tokens, passwords or sensitive tenant data.
- Request device permissions only when needed.
- Do not expose sensitive data in navigation parameters.
- UI role checks do not replace backend authorization.

## 8. BHOME-Specific Rules
- Staff actions must respect assigned Location scope.
- Staff must not view restricted tenant personal data.
- Meter readings require confirmation before submission.
- OCR output must be treated as a proposal, not final data.
- Handle camera permission denial and upload failures.
- Do not mark operations completed without backend confirmation.
- Tenant residence registration must follow the approved VNeID workflow.

## 9. Testing
- Follow existing testing tools and patterns.
- Test role-based navigation.
- Test form validation and API errors.
- Test loading, empty and failure states.
- Test duplicate submissions.
- Test permission denial for camera or media access.
- Test applicable Android and iOS behavior.
- Run existing lint, typecheck and test scripts when available.

## 10. Agent Restrictions
- Do not rewrite entire screens for small changes.
- Do not alter shared navigation without checking its consumers.
- Do not replace existing libraries without approval.
- Do not introduce mock data into production workflows.
- Do not change backend contracts without explicit requirements.

---

This is an Expo/React Native mobile application. Prioritize mobile-first patterns, performance, and cross-platform compatibility.

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any code that touches an Expo, EAS, or React Native API:

1. Read the major version of the `expo` package in `package.json`.
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch https://docs.expo.dev/llms.txt — an index of all Expo docs with corrections to common LLM misconceptions. Follow its links to the specific page you need; never answer from memory.

## Commands

Use `bunx` instead of `npx` if the project uses bun (`bun.lock` present).

```bash
npx expo install <package>  # ALWAYS use instead of npm/yarn/pnpm/bun add — resolves SDK-compatible versions
npx expo start              # start the dev server
npx expo lint               # lint
npx tsc --noEmit            # typecheck
npx expo-doctor             # diagnose dependency and config issues
npx expo install --fix      # fix incompatible package versions
```

Run lint and typecheck before declaring any task done.

## Navigation & Routing

- Use **Expo Router** for all navigation. Routes live in `src/app/` — every file there is a screen, `_layout.tsx` files define navigators. Keep non-route code (components, hooks, utils) outside `src/app/`.
- Import `Link`, `router`, and `useLocalSearchParams` from `expo-router`.
- Docs: https://docs.expo.dev/router/introduction.md

## Building with EAS

Use EAS to build, sign, and submit the app in the cloud (`eas build`, `eas submit`) and to ship over-the-air updates (`eas update`) — no local Xcode or Android Studio required. Run EAS CLI as `bunx eas-cli <command>` in Bun projects, or `npx eas-cli@latest <command>` otherwise; substitute that for bare `eas` in docs examples.
Docs: https://docs.expo.dev/eas/index.md

## Rules

- If `ios/` and `android/` directories do not exist, they are generated (Continuous Native Generation). Never create or edit them by hand — configure native behavior in `app.json` and config plugins.
- Expo Go only includes its bundled native modules. After adding a library with native code, the app needs a development build: `npx expo run:ios|android` locally, or `eas build --profile development`.
- Prefer recommended Expo modules over third-party libraries, and check your available skills before adding dependencies. Docs: https://docs.expo.dev/versions/latest/index.md
