# Workflow 02 — Create or Update One Feature Guide

## Trigger
A feature/scope is next in the curriculum, the user asks about it directly, or source changes may have made its guide stale.

1. Read the feature-register entry, curriculum position, prior guide, most recent review report and related learner-state notes.
2. Verify the source path is still valid. Inspect only as much code as needed to establish the actual behavior, but expand the trace if important links are missing.
3. Identify what the learner must understand before this feature. Reuse established concepts instead of redefining them; correct prior learner-state assumptions if needed.
4. Trace the actual behavior in order. For example, use trigger → decision/validation → state change → handoff → result. Adapt that shape when the subject has a different structure.
5. Draft/update the guide: purpose, concrete example, mental model, concepts explained as needed, main journey, grounded code trace, alternatives/failures, connection to prior/next units, synthesis and optional application check.
6. Place deeper technical reference after the conceptual on-ramp. It can be detailed; do not force every detail into the opening explanation.
7. Run the Stage-0 preflight (`tools/preflight-review.ps1`) and fix dead references, dead anchors and missing sections before review; then run the Independent Reviewer in a separate context with the guide, learner profile, rubric, preflight JSON, inlined reference excerpts and the analyst-produced claim/evidence index—not an open-ended request to audit the repository. The reviewer simulates a beginner over the lesson layer and follows the learner-facing references to their exact targets, and may inspect extra source only to resolve a concrete suspected error or material gap, within the configured budgets.
8. If the guide fails, revise according to prioritized findings and submit it again with a finding-ID → section → evidence change log. Re-run preflight, then review by delta: the changed sections, affected references and affected criteria only, with re-scoring limited to what changed. Do not change the score yourself.
9. If a factual issue needs wider source knowledge, ask the Repository Analyst to verify that specific claim. Do not make the reviewer redo source discovery.
10. Once it passes, store the approved score and review report; update status to `approved`. If source issues block review, mark the exact unresolved claim and status `blocked` or `needs_evidence`.
11. Update the curriculum index if the feature depends on or reveals another prerequisite. Do not silently reorder the curriculum without recording the reason.
