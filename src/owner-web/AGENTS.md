# BHOME Owner Web - AI Agent Rules

## 1. Scope
This application is the BHOME Owner Web Portal.

Primary role: Owner.

Follow the root AGENTS.md rules.
Use the frameworks and libraries already configured in the repository.

## 2. Architecture
Respect the existing project structure.

Typical responsibilities:
- routes/: Route definitions and protected routes.
- pages/: Page-level components.
- components/: Reusable UI components.
- services/: Backend API integration.
- hooks/: Reusable React logic, if present.
- types/: Shared TypeScript contracts, if present.

Follow the actual repository layout.

## 3. Coding Rules
- Follow existing React and TypeScript conventions.
- Prefer reusable, focused components.
- Separate page layout from reusable UI logic.
- Keep API communication in the service layer.
- Avoid duplicated logic and unnecessary abstractions.
- Follow existing code formatting and naming conventions.
- Use the existing state-management solution.
- Avoid unnecessary re-renders.

## 4. Routing and Authorization
- Use the existing routing mechanism.
- Protect Owner-only routes.
- Handle unauthorized and expired sessions.
- Never treat frontend route protection as sufficient security.
- Respect backend authorization responses.

## 5. API Integration
- Use the existing API client and services.
- Follow documented .NET backend API contracts.
- Do not invent DTO fields or response formats.
- Centralize authentication and error handling.
- Handle loading, empty, error and success states.
- Prevent accidental duplicate mutations.
- Refresh affected UI data after successful mutations.

## 6. UI/UX
- Follow the existing BHOME design system.
- Maintain consistency across dashboard pages.
- Support responsive desktop and tablet layouts.
- Use consistent typography, spacing and colors.
- Provide clear feedback for user actions.
- Show confirmation dialogs for destructive operations.
- Provide appropriate form validation.
- Support accessible keyboard interactions.

## 7. Tables and Forms
- Use existing reusable table and form components.
- Apply server-side pagination, sorting or filtering when supported by the API.
- Keep filter and pagination behavior consistent.
- Preserve form values appropriately during validation errors.
- Prevent double submission.
- Handle large datasets efficiently.

## 8. BHOME Business Rules
- Owner can manage authorized properties and rooms.
- Contract operations must follow backend workflow states.
- Invoice finalization requires authorized Owner action.
- Invoice adjustment follows its approval workflow.
- Payment status must come from backend verification.
- Display debt and invoice information accurately.
- Do not calculate final financial records independently when backend values exist.
- Do not fabricate dashboard statistics.
- Do not expose restricted tenant information.

## 9. Security
- Never expose access tokens or secrets in logs.
- Follow the existing approved authentication strategy.
- Do not introduce insecure token persistence.
- Never bypass authorization checks.
- Do not trust client-side validation alone.
- Protect sensitive information from unintended exposure.

## 10. Testing
- Follow existing test conventions.
- Test protected routes and unauthorized responses.
- Test form validation and submission.
- Test tables, filters and pagination.
- Test loading, empty and error states.
- Test destructive-operation confirmations.
- Test responsive layouts.
- Run existing lint, typecheck, test and build scripts when available.

## 11. Agent Restrictions
- Do not redesign existing pages unless requested.
- Do not modify unrelated dashboard modules.
- Do not install a new UI library without justification.
- Do not introduce fake API data into production code.
- Do not change backend API contracts without explicit requirements.
- Do not remove existing validation or authorization logic.
