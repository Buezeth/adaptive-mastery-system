# Repository instructions — Adaptive Mastery System

When the user requests codebase learning, feature explanation, or implementation documentation:

1. Follow `SKILL.md` and the role/workflow files under `agents/` and `workflows/`.
2. Inspect the repository and existing docs before writing source-specific claims.
3. Preserve project-specific conventions and source scope IDs.
4. Build a feature register and prerequisite-aware curriculum that accounts for every identified in-scope feature; mark omissions and unknown areas honestly.
5. Create detailed feature guides designed for progressive learning, with technical reference and source evidence.
6. Use a separate Independent Reviewer pass. Save scores, reasons, actionable findings and revision status. Revise and re-review until the gate passes or the issue is genuinely blocked, with each round required to reduce the open blocking count.
7. Keep reviewer work bounded: settle mechanical validity with `tools/preflight-review.mjs` (or the `preflight-review.ps1` shim), then let the Repository Analyst own broad implementation discovery while the reviewer simulates a beginner over the lesson layer only, follows the exact learner-facing references, and inspects extra source only to resolve a specific concern. Review the changed delta after a focused revision, not the whole guide. Never send the reviewer back through the entire repository by default. Budgets bound review mechanics and tool use, not explanation depth.
8. Do not impose arbitrary word, response, step, concept or code-line limits. Manage actual conceptual load instead.
9. Maintain progress so future sessions resume at the correct point. Never claim a guide was reviewed, a file was created, a command was run, or a concept was understood unless there is evidence.
10. When changing this kit itself, run `npm test` and keep every copy of a policy consistent: `SKILL.md`, `AGENTS.md`, `agents/00-orchestrator.md`, `agents/04-independent-reviewer.md`, `workflows/04-independent-review-loop.md`, `agents/HANDOFF_CONTRACT.md`, and `config/mastery-system.yaml`. See `CONTRIBUTING.md`.

Adapt file placement to the repository's conventions. Do not overwrite existing documentation without permission. Do not interpret these instructions as permission to change production code; the default task is to inspect and create/update learning documentation only.
