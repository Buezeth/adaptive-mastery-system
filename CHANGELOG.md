# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] — 2026-10-25

First distributable release. The kit was previously a folder copied by hand; it is now an
installable package with a deterministic review preflight.

### Added

- **Cross-platform installer** (`adaptive-mastery`): `init`, `update`, `doctor`, `uninstall`,
  `version`. Vendors the kit into `.adaptive-mastery/`, writes an `install.json` manifest with
  per-file hashes, and is idempotent via managed markers.
- **Harness adapters** for `AGENTS.md`-style tools, Claude Code (`.claude/skills/adaptive-mastery/`
  plus `CLAUDE.md`), and Cursor (`.cursor/rules/adaptive-mastery.mdc`), with auto-detection.
- **Review preflight** (`tools/preflight-review.mjs`): resolves every learner-facing reference,
  validates same-document and cross-document anchors, checks required sections, counts evidence
  rows, and recomputes the approval gate arithmetic. Exits non-zero for CI.
- **Review staging**: mechanical preflight → inlined evidence pack → layered review → delta rounds.
- **Two-layer review policy**: the lesson layer is simulated as a beginner; the `Technical reference`
  appendix is verified mechanically and spot-checked, never read as a novice.
- **Budgets** for reference reads, extra source inspections, spot checks and blocking findings, plus
  a strict-decrease convergence rule for revision rounds.
- **Timing instrumentation** in `progress.json` so a run's cost can be attributed per phase.
- **35 tests** covering installer idempotency, update/uninstall safety, harness adapters, dry-run,
  reference extraction, anchor validation and gate arithmetic.
- `docs/INSTALL.md`, MIT license, changelog, CI workflow across Windows, macOS and Linux.

### Changed

- `workflows/04-independent-review-loop.md` rewritten around the staged pipeline.
- `agents/04-independent-reviewer.md` gained review modes, the layer policy, budgets and fail-fast.
- `templates/review-report-template.md` is mode-aware: delta reports carry scores forward instead of
  restating ten criteria.
- `SKILL.md`, the orchestrator, the handoff contract and `AGENTS.md` now state the staged rules, so
  the six copies of the policy no longer drift.
- PowerShell preflight is now a thin shim over the Node implementation, so behaviour is identical on
  every platform.

### Fixed

- The preflight no longer mistakes an empty generic list for a type error on Windows PowerShell 5.1
  (the shim removes that path entirely).
- Managed-block writes no longer accumulate trailing blank lines across repeated installs.
- Uninstall no longer collapses meaningful blank lines elsewhere in `AGENTS.md`.
