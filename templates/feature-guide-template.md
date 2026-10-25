# [Feature / Scope ID] — [Learner-facing title]

> **Guide status:** Draft | Under review | Approved | Blocked  
> **Last source verification:** [date/commit when available]  
> **Review record:** [path or not yet reviewed]  
> **Scope mapping:** [source scope/spec IDs]

## What this helps the user do
Explain the user-visible capability in ordinary language. Begin with a concrete, source-supported situation.

## Why the feature needs to exist
Describe the real problem, risk or limitation that would exist without it. Distinguish verified design rationale from an inference about why the original author chose it.

## The first idea to understand
Build the mental model required to make sense of the feature. Introduce essential terms in context, when needed. Do not begin with a glossary or a dense component list.

## Follow one real example through the system
Choose an example that reflects actual behavior. Trace the main path in execution order. Use a diagram only if it makes the relationship clearer.

## How the implementation makes it happen
For each meaningful part, explain:
- what comes in and what comes out;
- what decision or work happens here;
- why the part exists;
- how it hands work or information to the next part.

Reference verified file paths and symbols. When asking the reader to open another resource, link to the narrowest useful target (guide heading/anchor, document section, file plus function/class, test, or code excerpt) and say what it helps explain. Avoid vague links to a folder or entire subsystem. Include code excerpts where they teach something; there is no fixed line limit. Explain unfamiliar syntax or framework behavior when it matters. Keep the opening part focused on understanding rather than giving every internal detail at once.

## What happens when things do not go as expected
Cover meaningful failure cases, validation, authorization/visibility conditions, retries, duplicate events, partial failures, or recovery paths relevant to this feature. Do not invent failure handling that is absent from the code.

## How this connects to the rest of the codebase
Explain prerequisites and related/upstream/downstream features. Distinguish concepts already covered from concepts that will be taught later.

## Technical reference

<!-- Review boundary: everything above is the lesson layer, reviewed as a novice. Everything from this heading down is the reference layer, checked and spot-checked rather than simulated. Keep the heading text exactly "## Technical reference". -->
Provide the useful implementation map: entry points, key functions/classes, data read/written, states/transitions, contracts, events/queues and tests. Organize this section for lookup rather than as the lesson's opening.

## Evidence and confidence
This table also serves as the compact claim-to-evidence index for review. The reviewer should use it for targeted questions, not as an instruction to re-audit the repository.

| Claim | Evidence (exact file/symbol/lines or document heading/section) | Evidence type | Confidence / caveat |
|---|---|---|---|
| [Source-backed claim] | [path + symbol] | Code / test / docs / config / inference | [high/medium/low + note] |

## Open questions or discrepancies
Record stale docs, unresolved intent, contradictory behavior and questions needed from the user. Write “None identified” only after checking.

## What you should now be able to reason about
State appropriate capabilities—not arbitrary outcomes. For example: explain the feature in plain language, trace its main path, predict what happens when a dependency fails, or connect the behavior to a neighboring feature.

## Optional application or understanding check
Add a relevant short task or prediction only when it reinforces the learning goal. Include a hidden/reviewer answer or success criteria in a clearly separated teacher note if appropriate.

---

## Internal author/reviewer notes (not part of the first teaching pass)
- Concepts introduced and where they are explained:
- Known learner prerequisites:
- Evidence that would materially change this explanation:
- Revision history:
