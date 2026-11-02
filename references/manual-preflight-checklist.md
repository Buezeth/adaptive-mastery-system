# Manual Stage-0 Preflight Checklist (No-Shell / No-Node Fallback)

Use this checklist **only** when the agent harness cannot execute `adaptive-mastery preflight <guide>` or `node .adaptive-mastery/tools/preflight-review.mjs <guide>`.

Mechanical validity must still be settled **before** engaging the Independent Reviewer. If any item below fails, return the guide to the Lesson Author immediately without running a pedagogical review pass.

## 1. Required sections and substance
Confirm the guide contains all ten top-level (`#` or `##`) sections, in order, and that none of them are empty or contain only placeholder text (`placeholder`, `TODO`, `TBD`, `...`):

1. `What this helps the user do`
2. `Why the feature needs to exist`
3. `The first idea to understand`
4. `Follow one real example through the system`
5. `How the implementation makes it happen`
6. `What happens when things do not go as expected`
7. `How this connects to the rest of the codebase`
8. `Technical reference` (exact heading required — marks the boundary between lesson layer and reference layer)
9. `Evidence and confidence` (must contain at least one populated claim-to-evidence row)
10. `What you should now be able to reason about`

## 2. Reference and symbol resolution
For every link `[label](target)` and inline code reference (`` `path/to/file.ext` ``, `` `path:line` ``, `` `path#L10` ``, `` `path -> symbol()` ``) outside fenced code blocks:

- **File/directory existence:** Verify the target path exists relative to either the guide's directory or the repository root.
- **Line ranges:** If `:line` or `#L10-L25` is given, verify the target file has at least that many lines.
- **Symbols:** If `path -> symbol()` or `path#symbol` is given, verify the identifier `symbol` actually appears in the target file.
- **Markdown anchors:** If `#anchor` is given on the guide or another `.md` file, verify a matching heading slug exists (accounting for `-1`, `-2` suffixes on duplicate headings).

## 3. Concept prerequisites and opening jargon check
- **Frontmatter prerequisites:** Check `introduces:` and `assumes:` in the guide's frontmatter. Every concept in `assumes:` must be introduced by an earlier curriculum unit or listed in `docs/learning/learner-profile.yaml` (`known_concepts`).
- **Opening section jargon:** Check `## What this helps the user do`. It must state the user-visible outcome in plain language and must **not** stack unexplained infrastructure terms (`outbox`, `Redis`, `lease`, `polling`, `idempotency`, `BullMQ`, `CQRS`, etc.) or use terms from `introduces:` before their need is established in `## Why the feature needs to exist` and `## The first idea to understand`.

## 4. Gate arithmetic and version binding (when checking a review report)
- **Complete 10-row scorecard:** Even in `delta` mode, all 10 criteria must appear in the scorecard table (with `re-scored` or `carried from iteration N` in the source column).
- **Thresholds (from `config/mastery-system.yaml`):**
  - Criteria 1, 2, 3, 4, 5 must each be `>= 3`.
  - Criteria 6, 7, 8, 9, 10 must each be `>= 2`.
  - The arithmetic mean of all 10 scores must be `>= 3.0`.
- **Convergence:** Across revision iterations, either the open blocking finding count strictly decreased or the severity-weighted total (`critical=3`, `major/blocking=2`, `minor/non-blocking=1`) strictly decreased.
- **Staleness:** If the guide or any referenced source file was edited after the review report was written, the approval is `stale` and does not pass until re-verified.
