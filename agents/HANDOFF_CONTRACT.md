# Multi-agent Handoff Contract

Use this contract when the harness supports agent delegation. When subagents are not supported, perform separated sequential passes with a fresh-context boundary rule (switch role persona, judge strictly from on-disk artifacts and the evidence pack). Each agent does distinct work; handoffs must avoid paying twice for the same repository investigation.

> All kit paths (`agents/`, `workflows/`, `templates/`, `config/`, `references/`, `tools/`, `CURRICULUM_FORMAT.md`) are relative to the kit root (`.adaptive-mastery/` when vendored, or the repository root here). Mutable overrides and learner state live in `docs/learning/config.local.yaml`, `docs/learning/learner-profile.yaml`, and `docs/learning/progress.json`.

## Orchestrator → Repository Analyst

Provide:
- requested repository/scope, bootstrap mode (`lazy`, `exhaustive`, or `diff`), and learner goal;
- project instructions and known documentation roots;
- existing feature register, if present;
- constraints on files that may be changed (never edit `.adaptive-mastery/` or production source).

Require:
- identified feature/scope inventory;
- evidence trail for implementation claims, with precise paths/symbols/line ranges;
- design assessment (`intended_design`, `accidental_or_workaround`, `questionable_or_bug`) for each traced mechanism;
- concise claim-to-evidence index for each learning unit;
- mechanical file coverage reconciliation (`adaptive-mastery validate`) and documentation discrepancies;
- confidence and unresolved questions;
- exact status for areas not inspected.

## Repository Analyst → Curriculum Planner

Provide:
- current feature register;
- source maps, concept relationships (`introduces_concepts`, `assumes_concepts`), and dependency relationships;
- repository feature/scope IDs;
- source confidence, design assessments, and open questions.

Require:
- ordered curriculum (`CURRICULUM_FORMAT.md`) with reason for each placement;
- `introduces` and `assumes` concept mappings per unit;
- a reconciliation of all identified feature IDs;
- explicit unresolved cycles or deferred units.

## Orchestrator → Lesson Author

Provide:
- one feature/unit ID at a time;
- curriculum position, `introduces` / `assumes` concepts, and prerequisite learner state;
- verified source map, concise claim/evidence index, design assessments, and relevant source excerpts/paths;
- explicit learner profile (`docs/learning/learner-profile.yaml`);
- existing guide and prior review findings, if updating.

Require:
- a full, source-grounded feature guide with YAML frontmatter (`unit_id`, `unit_order`, `introduces`, `assumes`) and non-placeholder content in all ten required sections;
- honest surfacing of `accidental_or_workaround` and `questionable_or_bug` code patterns;
- technical reference suitable for future lookup;
- learner-facing references that point to exact sections, symbols (`path -> symbol()`), line ranges (`path:10-25` or `path#L10-L25`), tests, or earlier lessons wherever possible;
- an explicit boundary between the lesson layer and the reference layer at `## Technical reference`, because review rigour and the preflight both key off that heading;
- active verification tasks (`explain_back`, `predict_then_verify`, `break_and_fix`);
- open questions and evidence table;
- no self-awarded review score or claim of approval.

## Orchestrator → Independent Reviewer

Provide in a separate context:
- candidate guide, version, and `guide_sha256`, with the review mode: `full`, `delta`, or `substantial_rewrite`;
- intended learner profile (`docs/learning/learner-profile.yaml`) and prior learner-state information relevant to this unit;
- review rubric, calibration baseline (`references/calibration-bad-guide.md`), and approval gate in `agents/04-independent-reviewer.md`;
- the Stage-0 preflight JSON (`node .adaptive-mastery/tools/preflight-review.mjs <guide> --emit-pack` or `adaptive-mastery preflight <guide> --emit-pack`) and its exit code;
- the emitted evidence pack: for each learner-facing reference, the path, symbol, line range, `sha256`, and inlined excerpt;
- the concise analyst-produced claim/evidence index, for targeted checks;
- review history, prior report, and the author's change log (delta passes only);
- the effective budgets from `config/mastery-system.yaml` (and `docs/learning/config.local.yaml`).

**Do not ask the reviewer to inspect the entire repository.** Explicitly tell it that repository discovery and source mapping have already been completed by the Repository Analyst, that mechanical validity is already settled by the preflight, and that its job is pedagogical judgment over the lesson layer. Its default path is to read the lesson as a novice and follow each learner-facing reference to the exact target or relevant section, preferring the inlined excerpt. It may inspect additional source only to resolve a concrete suspected inaccuracy or a material gap, inside the configured budgets. If wider evidence is needed, it should send the Analyst a targeted verification request rather than start a new repository scan.

Require:
- the mode, `Guide sha256`, `Evidence hashes`, and which gate criteria were evaluated;
- the complete 10-row scorecard table in every mode (marking unaffected rows as `carried from iteration N` in `delta` mode);
- precise locations where a beginner would become confused;
- a record of learner-facing references followed, references covered by the pack, and any extra source reads with the question each answered;
- budget usage and any overrun with its reason;
- targeted fact-check requests, if any;
- gate arithmetic and convergence check taken from the preflight (`--review-report`), not hand-computed;
- `PASS`, `NEEDS_REVISION`, or `BLOCKED` with reasons and actionable corrections.

## Reviewer → Lesson Author

Return the review report. Every blocking item must contain:
- a stable finding ID and explicit severity (`critical`, `major` / `blocking`, `minor` / `non-blocking`);
- the exact location in the guide;
- why it fails the learner-understanding standard;
- the precise reference or source evidence involved, if applicable;
- a concrete revision strategy.

The reviewer should describe the problem and target result, not force a rigid sentence template.

## Lesson Author → Reviewer (revision)

Return:
- revised guide, with the guide version incremented;
- a machine-checkable change log, one row per finding:

  | Finding ID | Guide section/anchor | Edit summary | Evidence for any new claim |
  |---|---|---|---|

- new or changed source claims and their evidence;
- unresolved issues, named by finding ID.

A finding with no change-log row is unresolved. For localized changes, the reviewer revisits the delta and affected references only. For a substantial rewrite, it rereads the whole lesson layer as a learner—but still does not re-audit the repository. Across rounds, either the open blocking count or the severity-weighted total must strictly decrease. The author must not alter the reviewer score or remove a finding without resolving it.

## Orchestrator → Learner

Expose the approved learning experience, not internal agent chatter. Report review state honestly when useful. Save the learner's questions, active verification results, and confusion signals in `docs/learning/learner-profile.yaml` and `docs/learning/progress.json`. If learner confusion exposes a flaw in an `approved` guide, demote the guide to `under_review` and revise it.
