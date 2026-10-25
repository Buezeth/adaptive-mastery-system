# Curriculum Format and Ordering Rules

Create `docs/learning/CURRICULUM.md` from the actual repository inventory. Do not fill this file with a generic order copied from a sample project.

For each unit, include:

- **Sequence and stable ID(s):** preserve source scope/spec IDs.
- **Learner-facing title:** a question or meaningful behavior, not unexplained architecture terminology.
- **Learning outcome:** what the learner should be able to explain or reason about.
- **Why it comes here:** the prior concepts that make this unit easier to understand.
- **Prerequisites:** units/concepts that have already been taught, and any brief prerequisite explanation needed now.
- **Implementation anchors:** source map/guide path and key evidence.
- **Gate status:** mapped, guide drafted, review passed/blocked, taught, learner developing/understood.
- **Links forward/back:** related concepts, including any deliberate return to a concept introduced provisionally earlier.

## Sequence construction

Use dependency relationships and user-visible journeys. A useful generic pattern—only if it fits the actual repository—is:

1. What the product is and what users need from it.
2. The smallest set of foundations required to follow a real user action.
3. Important user-visible vertical slices, in a natural order.
4. Shared mechanisms when their purpose is now concrete.
5. Asynchronous behavior, failure/recovery, permissions, observability and operational concerns in the order that makes their role intelligible.
6. Cross-feature synthesis and advanced cases.

This is not a mandatory sequence. Authentication may need to come first in one system; in another, a simple public path may provide a better entry point. Derive the real order. Avoid teaching infrastructure simply because it sits near the top of the source tree.

## Chronology has two meanings

- **Within a feature:** follow the real execution path from trigger to outcome and side effects.
- **Across the whole repository:** follow conceptual prerequisites and useful user journeys, with cross-links for shared services and cyclic dependencies.

The curriculum should be comprehensive, but a conversation should normally teach the next coherent unit rather than read the entire curriculum aloud.
