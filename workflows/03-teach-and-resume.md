# Workflow 03 — Teach, Verify, Diff Mode, and Resume

## Trigger
“Continue my curriculum”, “Explain Scope N”, “Explain this diff / recent AI change”, or a learner asks a follow-up during a lesson.

## Standard teaching and resume loop

1. Read `docs/learning/progress.json`, `docs/learning/learner-profile.yaml`, `docs/learning/CURRICULUM.md`, `docs/learning/feature-register.yaml`, the approved guide, and latest reviewer notes. Run `adaptive-mastery validate` to check whether any approved guide has become `stale` due to code edits.
2. **Check the spaced-retrieval queue first.** Inspect `learner_model.revisit_queue` in `docs/learning/progress.json`. If a concept or earlier unit is due for a brief retrieval revisit (`retrieval_revisit`), open with a quick 1-question retrieval check before advancing.
3. If a user requests a specific feature, honor that request. Check prerequisites (`assumes`) and briefly establish only the missing foundations needed; do not force them through already-understood units.
4. If the next guide is missing (`lazy` mode) or `stale`, run `workflows/02-create-or-update-feature-guide.md` and `workflows/04-independent-review-loop.md` before presenting it as approved. A preliminary explanation may be offered if useful, but clearly label it preliminary.
5. Start with a meaningful question/outcome and why the feature matters. Continue from what the learner already knows. Do not repeat the whole roadmap every turn.
6. Present a coherent learning portion of suitable depth. Choose example, visual, source trace, worked demonstration, or brief prediction based on the concept and learner signals (`references/Adaptive_Mastery_Coach_SKILL.md`). Surface whether the code reflects `intended_design`, `accidental_or_workaround`, or `questionable_or_bug`.
7. **Notice feedback and treat learner confusion as ground truth.** If the learner asks what a term means, says they are lost, or makes a wrong prediction because the guide was misleading:
   - Stop advancing and identify the missing concept.
   - Rebuild the explanation with a different representation or more basic prerequisite.
   - Record the confusion in `docs/learning/learner-profile.yaml` (`concepts_needing_attention` / `feedback_history`) and `docs/learning/progress.json`.
   - If an `approved` guide caused the confusion, demote its `review_status` in `feature-register.yaml` from `approved` to `under_review` and record it in `review_loop.demoted_guides` so the guide itself gets repaired.
8. **Produce active evidence of learning.** Do not award `understood` solely because the learner said “yes” or read a paragraph. Use an active verification task suited to the concept:
   - **`explain_back`:** The learner explains the mechanism or why a failure happens in their own words.
   - **`predict_then_verify`:** The learner predicts what a specific input, config tweak, or test will do, then verifies it against the code or test runner.
   - **`break_and_fix`:** The learner identifies what breaks when a specific line/condition is changed in the repo and how to fix it.
   - **`retrieval_revisit`:** Schedule newly understood or shaky concepts into `learner_model.revisit_queue` in `progress.json` (e.g. due after `teaching.spaced_revisit_interval_units: 2` units).
9. Update progress based on evidence: `exposed` means presented; `developing` means partial understanding; `understood` requires completed active verification evidence; `needs_revisit` means confusion remains (and queues a revisit).
10. Persist the current unit, lesson position, `last_guide_sha256`, concepts known/confused, completed verification tasks, `revisit_queue`, and next step in `docs/learning/progress.json` and `docs/learning/learner-profile.yaml`.

## Diff mode (learning while AI changes code)

When the user asks to explain a working-tree change, commit, pull request, or AI-generated edit:

1. Inspect `git diff` / `git show` to identify the exact modified files, functions, and lines.
2. Match the changed files against `evidence_paths` and `entry_points` in `docs/learning/feature-register.yaml`. Mark any affected `approved` guide as `stale`.
3. Classify the diff's changes (`intended_design`, `accidental_or_workaround`, or `questionable_or_bug`).
4. Explain the diff in causal order: what behavior changed, why the change was made, and how it interacts with existing concepts in the linked curriculum unit(s).
5. Ask **one focused prediction question** (`predict_then_verify`) about how the system will behave differently under a concrete scenario after this diff.

## Conversational rules
- Avoid forced “say next” endings. Offer a useful natural continuation only when it helps.
- Do not make every paragraph a quiz; use purposeful verification tasks.
- Do not dump the entire codebase or all stages in one turn when the learner asked to learn it progressively.
- If the learner explicitly asks for a comprehensive standalone guide, provide one, structured from foundations to detailed reference.
