# Workflow 04 — Bounded Independent Review and Revision

## Purpose

Review the learning quality of a feature guide without repeating repository discovery. The Repository Analyst owns broad implementation investigation and evidence gathering. The Independent Reviewer owns the beginner's experience: whether the guide and the references it points to are enough to build understanding.

## Why this workflow is staged

Review is the only phase that repeats for every unit and again for every revision round, so it sets the wall clock of a whole-repository run. Its cost is roughly:

```
units x revision rounds x (guide read + references followed + report written)
```

Three of those factors are controllable without weakening the gate:

- most of the *reading* is mechanical validation, which `tools/preflight-review.mjs` does exactly and instantly;
- most *reference following* re-derives evidence that `--emit-pack` inlines deterministically;
- most *revision rounds* re-read the whole guide when only two sections changed.

Do not fix this by lowering the bar. Fix it by never paying twice for the same knowledge.

## Stage 0 — Mechanical preflight and evidence pack (no model pass)

Run `tools/preflight-review.mjs` (or `adaptive-mastery preflight`) before any reviewer is engaged:

```bash
node .adaptive-mastery/tools/preflight-review.mjs <guide> --emit-pack [<pack.md>] [--review-report <report>] [--out <json>]
```

(When working in the kit repository itself, run `node tools/preflight-review.mjs <guide> --emit-pack`. If the agent harness has no shell/Node runtime, follow `references/manual-preflight-checklist.md`.)

It deterministically:
- tracks Markdown code fences and YAML frontmatter so comments/excerpts inside code blocks are never misparsed as headings or links;
- resolves every learner-facing reference (markdown links, inline `path/to/file.ext`, `path:line`, `path#L10-L25`, `path -> symbol()`, extensionless files like `Makefile`, and directories);
- verifies that cited symbols (`path -> symbol()`) and line ranges actually exist in the target file;
- validates same-document and cross-document anchors (including GitHub `-1`, `-2` suffixes on duplicate headings);
- checks that all ten required sections exist and contain non-placeholder content;
- checks `introduces:` and `assumes:` frontmatter against earlier units and flags unexplained jargon stacked in the opening section (calibrated against `references/calibration-bad-guide.md`);
- computes normalized SHA-256 hashes for the guide (`guide_sha256`) and every referenced file (`evidence_hashes`);
- emits the inlined **evidence pack** (`--emit-pack`) containing the exact excerpts for each resolved reference;
- given `--review-report <report>`, reads thresholds from `config/mastery-system.yaml` (and `docs/learning/config.local.yaml`) and recomputes the gate arithmetic, hash staleness (`stale`), and revision convergence.

- Exit `1` means a blocking mechanical defect. Return it to the author directly. A reviewer must never spend a pass discovering a broken link, missing symbol, or placeholder section.

## Stage 1 — Evidence pack handoff

The Orchestrator gives the reviewer a self-contained pack, not an assignment to explore:

- the candidate guide, version, and `guide_sha256`;
- learner profile (`docs/learning/learner-profile.yaml`) and relevant prior learner-state;
- the rubric, calibration baseline (`references/calibration-bad-guide.md`), and approval gate (`agents/04-independent-reviewer.md`);
- the preflight JSON and emitted **evidence pack** (`--emit-pack`) with path, symbol, line range, `sha256`, and inlined excerpt for each reference.

With excerpts inline, following a reference is a read, not a tool round trip. If the pack is missing a reference the reviewer needs, that is a defect in the handoff: request it from the Analyst, or open exactly that one location. It is never a licence to tour the repository.

## Stage 2 — Full review (once per guide)

The reviewer reads the **lesson layer** in order as a beginner and applies the whole rubric, calibrated against `references/calibration-bad-guide.md`. The **technical reference layer** (from `## Technical reference` onward) is not simulated as a beginner: it is verified against the preflight result plus at most `review.reference_spot_checks` (3) targeted claims, and scored only under grounded accuracy and depth.

Fail fast. Evaluate the hard-gate criteria first — grounded accuracy, purpose before machinery, prerequisite handling, conceptual load, cause and effect (each requiring `>= 3` in `config/mastery-system.yaml`). If one is clearly `<= 1` and the defect is not a small edit, stop the pass, report only those findings, and return `NEEDS_REVISION`.

## Stage 3 — Revision loop (delta by default)

1. Return the report: stable finding IDs, explicit severity (`critical` weight 3, `major` / `blocking` weight 2, `minor` / `non-blocking` weight 1), exact guide locations, why a beginner gets lost, and a concrete repair. At most `review.max_blocking_findings` (5), highest severity first, duplicates merged.
2. The author revises and returns a **machine-checkable change log**: finding ID → guide section/anchor → edit summary → evidence for any new claim.
3. Re-run Stage 0 preflight (`--emit-pack`) on the revised guide.
4. The reviewer receives the finding list, the change log, and the guide diff. It re-reads changed sections plus the surrounding context needed to judge them, re-follows only changed or affected references, and re-scores only the affected criteria.
5. **Keep all 10 rows in the Scorecard table in delta mode:** Mark unaffected rows as `carried from iteration N` in the Source column so `tools/preflight-review.mjs --review-report` can verify all 10 scores and compute the exact average.
6. Escalate to a `substantial_rewrite` full re-read only for a structural change: the teaching order moved, a new foundational concept was introduced, or more than roughly a third of the lesson layer was rewritten. State which trigger applied.
7. **Convergence rule:** Across rounds, either the **open blocking finding count must strictly decrease** OR the **severity-weighted total of open findings** (`critical=3`, `major/blocking=2`, `minor/non-blocking=1`) **must strictly decrease**. If a round achieves neither, the next round changes the teaching approach or asks the Analyst for the specific missing evidence.
8. **Version-bound approval and staleness:** When a guide passes, record `Guide sha256` and `Evidence hashes` from the preflight output in the review report, and run `node .adaptive-mastery/tools/preflight-review.mjs <guide> --review-report <report>` to confirm `gate.passes === true` and `gate.stale === false`. Any later edit to the guide or its referenced source files will automatically flag the review as `stale`.

## Budgets

Defaults live in `config/mastery-system.yaml` (and `docs/learning/config.local.yaml`). The Orchestrator may raise one for a specific unit with a stated reason, and the report records the actual counts used.

| Budget | Default | Exists to stop |
|---|---:|---|
| Full reference reads per pass | 12 | a guide with 40 links becoming a repo tour |
| Extra source inspections per pass | 5 | silent re-audit |
| Reference-layer spot checks | 3 | beginner-simulating a lookup appendix |
| Blocking findings per report | 5 | unfocused lists that trigger broad rewrites |
| Reference-layer novice simulation | off | paying lesson-level cost for reference text |

If a pass exhausts a budget, the reviewer says so and requests the missing evidence; it does not quietly continue.

## Parallelism and pipelining

Reviews of different units are independent. When the harness supports concurrent subagents, review up to `review.max_parallel_reviews` (3) units at once, and let the Lesson Author draft unit N+1 while unit N is under review (`review.pipeline_authoring`). Sequence only within a single unit's author → review → revise chain. Never parallelize revisions of the same guide.

## Timing

When `review.record_timings` is on, write per-phase `started_at`, `ended_at`, iteration count, findings opened/closed, budget usage, and verdict into `docs/learning/progress.json`.

## Review scope rules

- **Default:** learner simulation of the lesson layer + exact-reference follow-through from `--emit-pack` + targeted fact checks + preflight.
- **Not the default:** full repository re-audit, broad searching, rebuilding a feature map, or inspecting unrelated files.
- **Empirical ground truth:** If a real learner later gets confused on an `approved` guide during teaching, the guide is demoted to `under_review` and re-enters this loop.
- **Transparency:** record the scope of inspected sources, `Guide sha256`, `Evidence hashes`, and the mode used (`full`, `delta`, `substantial_rewrite`).
