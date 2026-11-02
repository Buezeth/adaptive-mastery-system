# Adaptive Mastery System

**Turn any codebase into a learning curriculum your agent can actually teach** — discovered from
source, ordered by prerequisites, and independently reviewed before you are taught.

[![CI](https://github.com/Buezeth/adaptive-mastery-system/actions/workflows/test.yml/badge.svg)](https://github.com/Buezeth/adaptive-mastery-system/actions/workflows/test.yml)
[![npm](https://img.shields.io/npm/v/adaptive-mastery.svg)](https://www.npmjs.com/package/adaptive-mastery)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

```bash
npx adaptive-mastery init
```

Works with `AGENTS.md`, Claude Code, Cursor, GitHub Copilot, Gemini, Windsurf, Cline, Aider, or any
custom file (`--harness custom --file <path>`), plus `print` and `bundle` fallbacks for web/chat UIs.
Zero dependencies, no build step.

---

## The problem

AI writes a lot of code. Understanding it is a different skill from producing it, and most
"explain this repo" output fails the same way: it opens with *outbox*, *Redis*, *lease*, *polling*,
and *idempotency* before explaining why any of those things exist.

A technically accurate explanation is not a teachable one. This system treats **understanding, not
information volume, as the unit of progress**:

- it discovers the real features and entry points from source (in `lazy` on-demand mode by default, or `exhaustive` mode) and reconciles coverage mechanically against `git ls-files`;
- it labels traced code as `intended_design`, `accidental_or_workaround`, or `questionable_or_bug` so you don't internalize AI-written accidents or bugs as architecture;
- it orders units by concept prerequisites (`introduces` / `assumes` frontmatter verified by preflight);
- it writes each guide from problem and observable behavior toward implementation;
- a **separate reviewer** (calibrated against `references/calibration-bad-guide.md`) scores the guide as a beginner and binds approval to SHA-256 hashes of the guide and its evidence files;
- it verifies active learning through `explain_back`, `predict_then_verify`, `break_and_fix`, spaced `retrieval_revisit` scheduling, and **diff mode** for explaining AI code changes as they happen;
- real learner confusion demotes an `approved` guide back to `under_review` for repair.

There is no fixed response-length or word-count limit. Depth is chosen from the subject and your
signals, not from a cap.

## Install

```bash
npx adaptive-mastery init                                    # auto-detects your harness
npx adaptive-mastery init --harness claude,cursor
npx adaptive-mastery init --harness custom --file RULES.md
npx adaptive-mastery init --harness all
```

Straight from this repository, no npm registry needed:

```bash
npx github:Buezeth/adaptive-mastery-system init
```

From a clone:

```bash
node install/cli.mjs init --target /path/to/project
```

Full options, universal fallbacks (`print`, `bundle`), CI usage, and troubleshooting: **[docs/INSTALL.md](docs/INSTALL.md)**.

## Use it

After installing, in your agent:

> Initialize the Adaptive Mastery System for this repository. Inspect existing documentation first,
> verify it against the implementation, inventory in-scope features, build the prerequisite-ordered
> curriculum, and prepare and review the first learning unit.

For later sessions:

> Continue my codebase mastery curriculum from the saved checkpoint. Check any due revisits, teach
> the next not-yet-understood unit using the approved guide, verify understanding actively, and update progress.

While vibe-coding or reviewing an AI change (**diff mode**):

> Explain the current git diff using the Adaptive Mastery System. Map changed files to the feature
> register, flag affected guides as stale, explain the causal change, and give me one prediction check.

## What it produces

```text
docs/learning/
  README.md                    # how to navigate the library
  config.local.yaml            # project-local config overrides (survives kit updates)
  learner-profile.yaml         # mutable learner preferences and feedback (gitignored by default)
  .gitignore                   # keeps personal progress.json and learner-profile.yaml local
  CURRICULUM.md                # ordered path, prerequisite rationale, coverage
  feature-register.yaml        # every in-scope feature, design assessment, evidence status
  progress.json                # resume checkpoint, revisit_queue, phase timings
  features/001-<slug>.md       # one reviewed guide per learning unit (with introduces/assumes)
  reviews/001-<slug>.review.md # 10-row scorecard, guide/evidence hashes, revision history
  source-maps/001-<slug>.md    # implementation trace and claim-to-evidence index
```

## Why review is fast without lowering the bar

| Stage | Cost | What it settles |
|---|---|---|
| Preflight (`preflight`) | seconds, no model | dead paths, `:line`/`#L10` ranges, missing `-> symbol()`, dead anchors (`-1` duplicates), fence-safe parsing, empty/placeholder sections, `introduces`/`assumes` prerequisites, opening jargon stacks, SHA-256 staleness, gate arithmetic |
| Evidence pack (`--emit-pack`) | deterministic | resolves every reference and inlines the exact excerpt with line ranges and SHA-256 |
| Layered review | one pass | the lesson is simulated as a beginner; the reference appendix is checked, not performed |
| Fail fast | partial pass | a guide that scores `<= 1` on a hard criterion returns immediately |
| Delta rounds | changed only | re-scores affected criteria while keeping all 10 scorecard rows (`carried from iteration N`); requires open blocking count or severity-weighted total to strictly decrease |

```bash
npx adaptive-mastery preflight docs/learning/features/001-upload.md --emit-pack
npx adaptive-mastery validate
```

## Commands

| Command | Purpose |
|---|---|
| `adaptive-mastery init` | vendor the immutable kit, seed `docs/learning/` state, and wire harness adapters |
| `adaptive-mastery doctor` | verify kit and adapter hashes (LF-normalized) |
| `adaptive-mastery update` | re-sync kit and union harnesses without touching `docs/learning/` |
| `adaptive-mastery uninstall` | remove managed files and blocks (cleaning up 0-byte created files) |
| `adaptive-mastery preflight <guide>` | deterministic Stage-0 preflight and `--emit-pack` generator |
| `adaptive-mastery validate` | validate `progress.json`, `feature-register.yaml`, approval gates, staleness, and `git ls-files` coverage |
| `adaptive-mastery calibrate` | verify preflight and reviewer calibration against `references/calibration-bad-guide.md` |
| `adaptive-mastery print` | print a self-contained standalone instruction block to stdout |
| `adaptive-mastery bundle` | generate a single self-contained `ADAPTIVE_MASTERY.md` file |

## Repository layout

```text
SKILL.md                    # top-level behaviour, path rules, capability fallbacks
CURRICULUM_FORMAT.md        # curriculum fields and dependency ordering rules
agents/                     # the five roles + handoff contract
workflows/                  # bootstrap (lazy/exhaustive), authoring, teach/diff, review loop
templates/                  # feature guide, review report, register, progress
config/                     # immutable kit defaults for system settings and learner profile
references/                 # coaching principles, manual preflight checklist, calibration-bad-guide
tools/                      # preflight-review.mjs (preflight, evidence pack, state/coverage validator)
install/                    # cross-platform CLI, harness registry, pointer templates
tests/                      # installer, preflight, and policy-drift tests
docs/INSTALL.md             # installation guide
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Run `npm test`.

## License

MIT © Buezeth
