# Multi-agent Handoff Contract

Use this contract when the harness supports agent delegation. Each agent should do distinct work; handoffs must avoid paying twice for the same repository investigation.

## Orchestrator → Repository Analyst

Provide:
- requested repository/scope and learner goal;
- project instructions and known documentation roots;
- existing feature register, if present;
- constraints on files that may be changed.

Require:
- identified feature/scope inventory;
- evidence trail for implementation claims, with precise paths/symbols/sections;
- concise claim-to-evidence index for each learning unit;
- documentation coverage and discrepancies;
- confidence and unresolved questions;
- exact status for areas not inspected.

## Repository Analyst → Curriculum Planner

Provide:
- current feature register;
- source maps and dependency relationships;
- repository feature/scope IDs;
- source confidence and open questions.

Require:
- ordered curriculum with reason for each placement;
- prerequisites and connections;
- a reconciliation of all identified feature IDs;
- explicit unresolved cycles or deferred units.

## Orchestrator → Lesson Author

Provide:
- one feature/unit ID at a time;
- curriculum position and prerequisite learner state;
- verified source map, concise claim/evidence index, and relevant source excerpts/paths;
- explicit learner profile;
- existing guide and prior review findings, if updating.

Require:
- a full, source-grounded feature guide;
- technical reference suitable for future lookup;
- learner-facing references that point to exact sections, symbols, functions, tests or earlier lessons wherever possible;
- an explicit boundary between the lesson layer and the reference layer at `## Technical reference`, because review rigour and the preflight both key off that heading;
- open questions and evidence table;
- no self-awarded review score or claim of approval.

## Orchestrator → Independent Reviewer

Provide in a separate context:
- candidate guide and version, with the review mode: `full`, `delta`, or `substantial_rewrite`;
- intended learner profile and prior learner-state information relevant to this unit;
- review rubric and approval gate in `agents/04-independent-reviewer.md`;
- the Stage-0 preflight JSON (`tools/preflight-review.ps1`) and its exit code;
- an evidence pack: for each learner-facing reference, the path, symbol, line range, and the excerpt that makes the point;
- the concise analyst-produced claim/evidence index, for targeted checks;
- review history, prior report and the author's change log (delta passes only);
- the effective budgets from `config/mastery-system.yaml`.

**Do not ask the reviewer to inspect the entire repository.** Explicitly tell it that repository discovery and source mapping have already been completed by the Repository Analyst, that mechanical validity is already settled by the preflight, and that its job is pedagogical judgment over the lesson layer. Its default path is to read the lesson as a novice and follow each learner-facing reference to the exact target or relevant section, preferring the inlined excerpt. It may inspect additional source only to resolve a concrete suspected inaccuracy or a material gap, inside the configured budgets. If wider evidence is needed, it should send the Analyst a targeted verification request rather than start a new repository scan.

Require:
- the mode and which gate criteria were evaluated;
- scores for the evaluated criteria (all ten in `full`; re-scored only, plus carried scores, in `delta`);
- precise locations where a beginner would become confused;
- a record of learner-facing references followed, references covered by the pack, and any extra source reads with the question each answered;
- budget usage and any overrun with its reason;
- targeted fact-check requests, if any;
- gate arithmetic taken from the preflight, not hand-computed;
- `PASS`, `NEEDS_REVISION`, or `BLOCKED` with reasons and actionable corrections.

## Reviewer → Lesson Author

Return the review report. Every blocking item must contain:
- a stable finding ID;
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

A finding with no change-log row is unresolved. For localized changes, the reviewer revisits the delta and affected references only. For a substantial rewrite, it rereads the whole lesson layer as a learner—but still does not re-audit the repository. The author must not alter the reviewer score or remove a finding without resolving it.

## Orchestrator → Learner

Expose the approved learning experience, not internal agent chatter. Report review state honestly when useful. Save the learner's questions and evidence of understanding, but do not show raw internal deliberations; show conclusions, sources and actionable rationale instead.
