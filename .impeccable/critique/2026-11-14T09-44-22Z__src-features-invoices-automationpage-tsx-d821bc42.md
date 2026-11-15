---
target: /billing-automation
total_score: 23
max_score: 40
na_heuristics:
p0_count: 0
p1_count: 4
target_identity: "file:D:\\SEP490-G92-BHOME\\src\\owner-web\\src\\features\\invoices\\AutomationPage.tsx"
target_fingerprint: 'sha256:7d4cb3cdbe003b7b6fcdd5dc006008bfba5e1acead4411a91811f583572fda93'
target_path: "D:\\SEP490-G92-BHOME\\src\\owner-web\\src\\features\\invoices\\AutomationPage.tsx"
timestamp: 2026-11-14T09-44-22Z
slug: src-features-invoices-automationpage-tsx-d821bc42
---

# Impeccable critique: /billing-automation (14/11/2026)

Method: dual-agent independent UX review and deterministic scan; source-only, no browser access.

## Design health score

23/40 Nielsen heuristic assessment: system visibility 2; real-world match 3; user control 3; consistency 3; error prevention 3; recognition 2; efficiency 2; minimalism 2; error recovery 2; help 1. Provisional score based on source, not field usability data.

## Specificity

BHOME's domain guards, effective period, date-gated manual actions and disabled automation are strong. Overall structure remains an administrator form rather than a clear room/month billing workflow.

## Strengths

- EffectiveFrom is separate from selected test period.
- Developer-only manual actions, duplicate checks, no automatic enable.
- Final issue requires explicit confirmation and backend revalidation.

## Priority issues

- P1: expanded-by-default schedule form with many technical date/offset fields sits before operational action; collapse into readable current summary after first save.
- P1: four coequal manual action buttons, Final primary despite disabled state; show four sequenced operational steps and focus next eligible action.
- P1: disabled reasons scattered across alerts; attach eligibility, blocker and recovery step to each action.
- P1: ambiguous representative needs direct inline recovery action, not buried in advanced monitoring.
- P2: meter picker appears mandatory for Draft though only room+period is needed; visually separate meter tasks from invoice actions.
- P2: preview fetch failures disable actions but do not clearly identify root cause at action; clarify failure and retry.
- P2: one-page invoice check should be verified for duplicate detection; history[0] ordering and calendar source need authoritative confirmation.
- P3: standardize Vietnamese labels and date formats; preserve mobile keyboard/accessibility.

## Personas

First-time Owner: sees configuration before task, unclear which action to take and why disabled.
Power Owner: spends effort switching room and period, checking dispersed status. Needs clear current scope and action outcomes.
Accessibility-dependent user: disabled status descriptions should stay close to controls and be exposed to screen readers; responsive layout code exists but browser not assessed.

## Detector and limitations

Impeccable detect on AutomationPage.tsx returned [] (0 findings); this cannot rule out task-hierarchy UX problems. No interactive browser/DOM inspection tool exposed, hence no live screenshot, overlay or mobile visual validation.

## Recommended information architecture

1. compact current schedule effectiveFrom summary with edit toggle
2. choose location, period and room once
3. four step-specific cards: Initial, Periodic, Draft, Final
4. inline eligibility, blockers, last outcome, link to task/invoice
5. advanced technical monitoring collapsed.

## Questions to consider

What is the most frequent Owner goal here: configure a schedule once or repeatedly run a specific room-month through issuance? Should the safe next valid action be the only prominent button?
