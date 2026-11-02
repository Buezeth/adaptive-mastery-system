# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] — 2026-11-02

### Added

- **Data-driven harness registry** (`HARNESS_REGISTRY` in `install/cli.mjs`): supports `agents`,
  `claude`, `cursor`, `copilot`, `gemini`, `windsurf`, `cline`, `aider`, plus `--harness custom --file <path>`.
- **Universal CLI commands**:
  - `adaptive-mastery preflight <guide>`: single cross-platform Node entry point for Stage-0 preflight.
  - `adaptive-mastery validate`: validates `progress.json` and `feature-register.yaml`, checks approved
    guides for passing gates and SHA-256 staleness, enforces active verification tasks for `understood`
    concepts/units, and computes a mechanical `git ls-files` coverage report (`uncited_files`).
  - `adaptive-mastery calibrate`: verifies mechanical and reviewer calibration against `references/calibration-bad-guide.md`.
  - `adaptive-mastery print`: writes a self-contained standalone instruction block to stdout.
  - `adaptive-mastery bundle`: builds a single self-contained `ADAPTIVE_MASTERY.md` for chat/web UIs.
- **Evidence pack generator** (`--emit-pack`): deterministically resolves every reference in a guide
  (by line range, symbol, or heading anchor) and inlines the excerpt and SHA-256 hash.
- **Mechanical prerequisite and jargon checks**: guides declare `introduces:` and `assumes:` in
  frontmatter; preflight verifies assumed concepts against earlier units and flags unexplained jargon
  stacked in the opening section.
- **Permanent calibration fixture** (`references/calibration-bad-guide.md`) and no-shell fallback
  checklist (`references/manual-preflight-checklist.md`).
- **Active learning, diff mode, lazy bootstrap mode, and code-quality classification**:
  - `lazy` bootstrap mode (default) maps shallowly first and deep-traces/reviews units on demand.
  - `diff` mode explains AI code changes causally, flags affected guides `stale`, and asks a prediction check.
  - Analyst and Author classify code as `intended_design`, `accidental_or_workaround`, or `questionable_or_bug`.
  - Active verification tasks (`explain_back`, `predict_then_verify`, `break_and_fix`, and spaced
    `retrieval_revisit` via `revisit_queue` in `progress.json`).
  - Empirical learner confusion signals demote `approved` guides back to `under_review`.
- **Policy drift test suite** (`tests/policy.test.mjs`) guarding thresholds, payload completeness,
  and command consistency across all documentation files.

### Changed

- **Immutable kit vs mutable user state split**: `.adaptive-mastery/` stays strictly immutable;
  `init` seeds user-owned `docs/learning/config.local.yaml`, `docs/learning/learner-profile.yaml`,
  and `docs/learning/.gitignore` only if absent, and `update`/`uninstall` never overwrite or remove them.
- **Pointer adapters instead of copies**: Claude skill adapter writes a lightweight pointer stub at
  `.claude/skills/adaptive-mastery/SKILL.md` and uses a pointer block in `CLAUDE.md` when `AGENTS.md`
  is active so instructions are never loaded twice.
- **Single source of truth for thresholds**: `parseGate` loads minimum scores directly from
  `config/mastery-system.yaml` (and `docs/learning/config.local.yaml`).
- **Delta review scorecards**: keep all 10 rows in the Scorecard table with a `Source` column
  (`re-scored` vs `carried from iteration N`) so mechanical gate verification succeeds in delta mode.
- **Severity-weighted convergence**: revision rounds pass convergence when either the open blocking
  count or the severity-weighted total (`critical=3`, `major/blocking=2`, `minor/non-blocking=1`)
  strictly decreases.

### Fixed

- Preflight now uses `realpathSync` for direct invocation, tracks Markdown code fences and YAML
  frontmatter, validates `path:line`, `path#L10`, `path -> symbol()`, extensionless files (`Makefile`),
  directories, duplicate heading slugs (`-1`, `-2`), and rejects empty or `"placeholder"` required sections.
- Approval is now bound to `guide_sha256` and `evidence_hashes`, automatically flagging edited
  guides or modified source files as `stale`.
- Installer normalizes CRLF to LF before hashing, tracks all adapter hashes in `install.json`,
  unions harnesses on `update --harness`, removes 0-byte created files on `uninstall`, vendors
  `CURRICULUM_FORMAT.md`, excludes maintainer-only `docs/RELEASING.md`, and strips duplicate skill
  frontmatter from `references/Adaptive_Mastery_Coach_SKILL.md`.

## [1.0.0] — 2026-10-25

First distributable release.
