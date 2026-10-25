# Workflow 04 — Bounded Independent Review and Revision

## Purpose

Review the learning quality of a feature guide without repeating repository discovery. The Repository Analyst owns broad implementation investigation and evidence gathering. The Independent Reviewer owns the beginner's experience: whether the guide and the references it points to are enough to build understanding.

## Why this workflow is staged

Review is the only phase that repeats for every unit and again for every revision round, so it sets the wall clock of a whole-repository run. Its cost is roughly:

```
units x revision rounds x (guide read + references followed + report written)
```

Three of those factors are controllable without weakening the gate:

- most of the *reading* is mechanical validation, which a script does exactly and instantly;
- most *reference following* re-derives evidence the Analyst already holds;
- most *revision rounds* re-read the whole guide when only two sections changed.

Do not fix this by lowering the bar. Fix it by never paying twice for the same knowledge.

## Stage 0 — Mechanical preflight (no model pass)

Run `tools/preflight-review.ps1` before any reviewer is engaged.

```powershell
./tools/preflight-review.ps1 -GuidePath <guide> [-ReviewReport <report>] [-OutFile <json>]
```

It resolves every learner-facing reference (markdown links, inline `path/to/file.ext` and `path -> symbol` forms), validates same-document and cross-document anchors, checks the template's required sections, counts evidence-table rows, and — given a report — recomputes the gate arithmetic.

- Exit `1` means a blocking defect that no amount of pedagogical reading can cure: a dead path, a dead anchor, a missing required section. Return it to the author directly. This is not a review finding; it is a broken reference.
- The JSON it prints is the **evidence pack index** passed to the reviewer in Stage 1.
- A reviewer must never spend a pass discovering that a link is broken.

## Stage 1 — Evidence pack

The Orchestrator gives the reviewer a pack, not an assignment to explore:

- the candidate guide and version;
- learner profile and relevant prior learner-state;
- the rubric and approval gate (`agents/04-independent-reviewer.md`);
- the preflight JSON;
- **inlined excerpts** for each learner-facing reference: path, symbol, line range, and the 10–40 lines that make the point.

With excerpts inline, following a reference is a read, not a tool round trip. If the pack is missing a reference the reviewer needs, that is a defect in the handoff: request it from the Analyst, or open exactly that one location. It is never a licence to tour the repository.

## Stage 2 — Full review (once per guide)

The reviewer reads the **lesson layer** in order as a beginner and applies the whole rubric. The **technical reference layer** (from `## Technical reference` onward) is not simulated as a beginner: it is verified against the preflight result plus at most `review.reference_spot_checks` targeted claims, and scored only under grounded accuracy and depth. A lookup appendix is not a lesson, and reading it as one is both slow and the wrong test.

Fail fast. Evaluate the hard-gate criteria first — grounded accuracy, purpose before machinery, prerequisite handling, conceptual load, cause and effect. If one is clearly `<= 1` and the defect is not a small edit, stop the pass, report only those findings, and return `NEEDS_REVISION`. Do not spend a full scorecard justifying a guide that cannot pass.

## Stage 3 — Revision loop (delta by default)

1. Return the report: stable finding IDs, exact guide locations, why a beginner gets lost, and a concrete repair. At most `review.max_blocking_findings`, highest severity first, duplicates merged.
2. The author revises and returns a **machine-checkable change log**: finding ID → guide section/anchor → edit summary → evidence for any new claim.
3. Re-run Stage 0 preflight on the revised guide.
4. The reviewer receives the finding list, the change log, and the guide diff. It re-reads changed sections plus the surrounding context needed to judge them, re-follows only changed or affected references, and re-scores only the affected criteria. Unaffected scores carry forward.
5. Escalate to a full re-read only for a structural change: the teaching order moved, a new foundational concept was introduced, or more than roughly a third of the lesson layer was rewritten. State which trigger applied.
6. Convergence is required, not just iteration: each round must strictly reduce the count of open blocking findings. If it does not, the next round changes the teaching approach or asks the Analyst for the specific missing evidence. Repeating the same feedback is a failed round, not a slow one.
7. Store the current report and revision history. Only the Independent Reviewer may report review status.

## Budgets

Defaults live in `config/mastery-system.yaml`. The Orchestrator may raise one for a specific unit with a stated reason, and the report records the actual counts used.

| Budget | Default | Exists to stop |
|---|---:|---|
| Full reference reads per pass | 12 | a guide with 40 links becoming a repo tour |
| Extra source inspections per pass | 5 | silent re-audit |
| Reference-layer spot checks | 3 | beginner-simulating a lookup appendix |
| Blocking findings per report | 5 | unfocused lists that trigger broad rewrites |
| Reference-layer novice simulation | off | paying lesson-level cost for reference text |

If a pass exhausts a budget, the reviewer says so and requests the missing evidence; it does not quietly continue.

## Parallelism and pipelining

Reviews of different units are independent. When the harness supports concurrent subagents, review up to `review.max_parallel_reviews` units at once, and let the Lesson Author draft unit N+1 while unit N is under review (`review.pipeline_authoring`). Sequence only within a single unit's author → review → revise chain. Never parallelize revisions of the same guide.

## Timing

When `review.record_timings` is on, write per-phase `started_at`, `ended_at`, iteration count, findings opened/closed, budget usage and verdict into `progress.json`. A run whose cost cannot be attributed cannot be improved; a phase that looks slow may be one pathological guide rather than the phase itself.

## Review scope rules

- **Default:** learner simulation of the lesson layer + exact-reference follow-through + targeted fact checks + preflight.
- **Not the default:** full repository re-audit, broad searching, rebuilding a feature map, or inspecting unrelated files.
- **Source of truth:** the Analyst's evidence pack for implementation claims; investigate only where the guide's wording, a cited reference, or a credible uncertainty creates a concrete reason.
- **Transparency:** record the scope of inspected sources and the mode used (`full`, `delta`, `substantial_rewrite`). Do not claim a full implementation audit if only the lesson layer and its references were reviewed.

## Required report content

Mode, guide version, iteration, the ten scores (or only the re-scored criteria in delta mode) with short evidence-based reasons, exact learner-confusion points and why they fail, learner-facing references followed, extra source reads with the question each answered, budget usage, blocking and non-blocking findings with stable IDs and concrete repairs, targeted Analyst requests, and the decision with its gate arithmetic.
