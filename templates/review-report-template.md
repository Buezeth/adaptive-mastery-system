# Independent Review — [Feature ID / Guide title]

- **Mode:** `full` | `delta` | `substantial_rewrite`
- **Guide version / commit:** [identifier]
- **Guide sha256:** `[64-character sha256 from preflight]`
- **Review iteration:** [number]
- **Reviewer:** Independent Reviewer
- **Review status:** `PASS` | `NEEDS_REVISION` | `BLOCKED`
- **Intended learner:** [background/goal, or cautious default]
- **Preflight:** [path to `tools/preflight-review.mjs` JSON, and its exit code]
- **Gate criteria evaluated:** [all ten, or the re-scored subset]
- **Structural-change trigger:** [only for `substantial_rewrite`: order moved / new foundational concept / ≥⅓ lesson rewritten]

> Delete the sections this mode does not use. A delta report that restates the whole guide has re-run the review and wasted the round, but the Scorecard table below must always keep all 10 rows (marking unaffected rows as `carried from iteration N`) so mechanical gate verification succeeds.

## Review scope and learner path
- **Lesson layer:** [sections read in order]
- **Reference layer:** [spot-checked claims, up to the configured limit]
- **Learner-facing references followed:** [link/path/anchor and the specific portion checked]
- **References covered from the evidence pack instead of opened:** [count]
- **Additional source locations inspected:** [each exact location and the specific question it answered; write `None` if none]
- **Analyst evidence relied on:** [claim/evidence index or source-map entry]
- **Broad repository re-audit performed:** `No` by default; explain only if an exceptional, explicitly authorized reason required it.

## Budget usage

| Budget | Limit | Used | Overrun reason |
|---|---:|---:|---|
| Full reference reads | 12 | | |
| Extra source inspections | 5 | | |
| Reference spot checks | 3 | | |
| Blocking findings | 5 | | |

## Scorecard

Keep all 10 rows in every mode so `adaptive-mastery preflight --review-report` can verify the complete gate arithmetic. In `delta` mode, mark unchanged rows as `carried from iteration N` in the Source column.

| Criterion | Score (0–4) | Source (`re-scored` or `carried from iteration N`) | Evidence and reason |
|---|---:|---|---|
| 1. Grounded accuracy | | | |
| 2. Purpose before machinery | | | |
| 3. Prerequisite handling | | | |
| 4. Conceptual load and terminology timing | | | |
| 5. Cause-and-effect clarity | | | |
| 6. Concrete grounding | | | |
| 7. Sequence and coherence | | | |
| 8. Engagement and pacing | | | |
| 9. Depth and reference usefulness | | | |
| 10. Independent capability | | | |
| **Average** | | `/4` | From preflight (`parseGate`), not hand-computed |

## Evidence hashes

Record the SHA-256 hashes from `preflight.evidence_hashes` so future runs detect when source changes make this review `stale`:

- `[relative/path/to/file.ext]`: `[64-character sha256]`

## Fail-fast record (full mode)
- **Hard criterion at or below 1:** [criterion, or `None`]
- **Pass stopped early:** [yes/no, and what was therefore not evaluated]

## Guess log

- [on-ramp] (section, line) the word or step, and what you guessed it meant

## Blocking findings

### [F-01] [Short, specific finding]
- **Status:** `open` | `closed`
- **Severity:** `critical` (weight 3) | `major` / `blocking` (weight 2) | `minor` / `non-blocking` (weight 1)
- **Location:** [section / paragraph / source reference]
- **Why it blocks understanding or trust:** [concrete explanation]
- **Evidence checked:** [source path/symbol/test, or "evidence pack"]
- **Required change:** [specific teaching-order or wording/content fix]

## Recommended revisions in priority order
1. [Actionable revision]

## Source accuracy and uncertainty
- Confirmed claims:
- Claims not independently confirmed:
- Documentation/code discrepancies observed in references actually checked:
- Targeted fact-check requests sent to Repository Analyst:
- User clarification needed:

## Decision
Explain whether the approval gate passes. A polished or extensive guide does not pass if a critical criterion fails or if the guide/evidence hashes are stale.

- Gate arithmetic: [cite the preflight `gate` object: scores, average, stale status, failing reasons]
- Open blocking findings carried into the next round: [count]

## Revision history

| Iteration | Mode | Changes checked | Findings opened | Findings closed | Open blocking | Severity weight | Result |
|---|---|---|---:|---:|---:|---:|---|
| 1 | full | | | | | | |
| 2 | delta | | | | | | |

**Convergence:** Across rounds, either the open blocking finding count must strictly decrease OR the severity-weighted total of open findings (`critical=3`, `major/blocking=2`, `minor/non-blocking=1`) must strictly decrease. If a round achieves neither, record what changes next (teaching approach, or the specific evidence requested from the Analyst).
