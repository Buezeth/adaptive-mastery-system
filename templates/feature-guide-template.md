---
unit_id: "000-template"
unit_order: 0
introduces: []
assumes: []
terms: []   # every new word this lesson teaches, as "term :: plain-language meaning (4+ words)"
---

# [Feature / Scope ID] — [Learner-facing title]

> **Last source verification:** [date/commit when available]  
> **Scope mapping:** [source scope/spec IDs]
<!-- Guide approval status lives in docs/learning/feature-register.yaml and docs/learning/progress.json; Guide sha256 lives in the review report so approving a guide never mutates its own hash. -->

## What this helps the user do
<!-- On-ramp: plain words only. No code names, no backticks, no file links. Give each part a nickname. -->
Explain the user-visible capability in ordinary language. Begin with a concrete, source-supported situation before introducing implementation terminology or infrastructure names.

## Why the feature needs to exist
<!-- On-ramp: plain words only. No code names, no backticks, no file links. Give each part a nickname. -->
Describe the real problem, risk or limitation that would exist without it. Distinguish verified design rationale from an inference about why the original author chose it.

## The first idea to understand
<!-- On-ramp: plain words only. No code names, no backticks, no file links. Give each part a nickname. -->
Build the mental model required to make sense of the feature. Open with an everyday object or situation ("Imagine ...") before any technical word. Introduce essential terms in context, bolded at first mention with their plain meaning in the same sentence, and only after their purpose is clear. Give every moving part a plain nickname. Do not begin with a glossary or a dense component list.

## Follow one real example through the system
<!-- On-ramp: plain words only. No code names, no backticks, no file links. Give each part a nickname. -->
Choose an example that reflects actual behavior and walk through one toy run with made-up numbers (explicitly labelled as made up) using the plain nicknames. Trace the main path in execution order. Use a diagram (fenced as `diagram`) only if it makes the relationship clearer.

## How the implementation makes it happen
Start with a table that maps each plain nickname from the on-ramp to its real name in the code and where it lives. Code names, file paths, line numbers, and code blocks appear for the first time here:

| Plain name | Name in the code | Where |
|---|---|---|
| [plain nickname] | `[symbolName]` | `[path/to/file.ext]` (or `[path/to/file.ext](../../../path/to/file.ext#L10)`) |

For each meaningful part, explain:
- what comes in and what comes out;
- what decision or work happens here;
- why the part exists;
- how it hands work or information to the next part;
- whether the implementation reflects **intended design**, an **accidental pattern / workaround**, or a **questionable choice / potential bug** so the learner does not mistake accidental AI-written patterns for deliberate architecture.

Reference verified file paths and symbols. When asking the reader to open another resource, link to the narrowest useful target (guide heading/anchor, document section, file plus function/class, line range, test, or code excerpt) and say what it helps explain. Avoid vague links to a folder or entire subsystem. Include code excerpts where they teach something; there is no fixed line limit. Explain unfamiliar syntax or framework behavior when it matters. Keep the opening part focused on understanding rather than giving every internal detail at once.

## What happens when things do not go as expected
Cover meaningful failure cases, validation, authorization/visibility conditions, retries, duplicate events, partial failures, or recovery paths relevant to this feature. Do not invent failure handling that is absent from the code; if error handling is missing or buggy in the implementation, state that explicitly.

## How this connects to the rest of the codebase
Explain prerequisites (`assumes`) and related/upstream/downstream features. Distinguish concepts already covered in earlier units from concepts introduced here (`introduces`) and concepts that will be taught later.

## Technical reference

<!-- Review boundary: everything above is the lesson layer, reviewed as a novice. Everything from this heading down is the reference layer, checked and spot-checked rather than simulated. Keep the heading text exactly "## Technical reference". -->
Provide the useful implementation map: entry points, key functions/classes, data read/written, states/transitions, contracts, events/queues, tests, and design-quality notes (`intended_design` vs `accidental_or_workaround` vs `questionable_or_bug`). Organize this section for lookup rather than as the lesson's opening.

## Evidence and confidence
This table also serves as the compact claim-to-evidence index for review. The reviewer should use it for targeted questions, not as an instruction to re-audit the repository.

| Claim | Evidence (exact file/symbol/lines or document heading/section) | Evidence type | Design assessment | Confidence / caveat |
|---|---|---|---|---|
| [Source-backed claim] | [path + symbol + lines] | Code / test / docs / config / inference | intended_design / accidental_or_workaround / questionable_or_bug | [high/medium/low + note] |

## Open questions or discrepancies
Record stale docs, unresolved intent, accidental/buggy patterns, contradictory behavior and questions needed from the user. Write “None identified” only after checking.

## What you should now be able to reason about
State concrete capabilities—not passive recognition. Include at least one active verification task suited to the unit:
- **Explain it back (`explain_back`):** Explain the mechanism or causal chain in your own words without relying on unexplained labels.
- **Predict, then verify (`predict_then_verify`):** Predict what a specific input, configuration change, or test case will produce, then verify against the code or test run.
- **Break and fix (`break_and_fix`):** Identify what breaks if a specific condition or handoff is altered in the repository and how to restore it.

---

## Internal author/reviewer notes (not part of the first teaching pass)
- Concepts introduced (`introduces`) and where they are explained:
- Known learner prerequisites (`assumes`):
- Evidence that would materially change this explanation:
- Revision history:
