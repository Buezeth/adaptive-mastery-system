# Adaptive Mastery System

**Turn any codebase into a learning curriculum your agent can actually teach** — discovered from
source, ordered by prerequisites, and independently reviewed before you are taught.

[![CI](https://github.com/Buezeth/adaptive-mastery-system/actions/workflows/test.yml/badge.svg)](https://github.com/Buezeth/adaptive-mastery-system/actions/workflows/test.yml)
[![npm](https://img.shields.io/npm/v/adaptive-mastery.svg)](https://www.npmjs.com/package/adaptive-mastery)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

```bash
npx adaptive-mastery init
```

Works with AGENTS.md-style tools, Claude Code, and Cursor. No dependencies, no build step.

---

## The problem

AI writes a lot of code. Understanding it is a different skill from producing it, and most
"explain this repo" output fails the same way: it opens with *outbox*, *Redis*, *lease*, *polling*,
and *idempotency* before explaining why any of those things exist.

A technically accurate explanation is not a teachable one. This system treats **understanding, not
information volume, as the unit of progress**:

- it discovers the real features and entry points from source;
- it orders them by what you must understand first;
- it writes each guide from problem and observable behavior toward implementation;
- a **separate reviewer** scores the guide as a beginner and sends specific defects back;
- progress, curriculum, and review state persist so the next session resumes exactly where you stopped.

There is no fixed response-length or word-count limit. Depth is chosen from the subject and your
signals, not from a cap.

## Install

```bash
npx adaptive-mastery init              # auto-detects your harness
npx adaptive-mastery init --harness claude
npx adaptive-mastery init --harness all
```

From a clone, without npm:

```bash
./install.sh --target /path/to/project      # macOS / Linux
./install.ps1 -Target C:\path\to\project    # Windows
```

Full options, manual install, CI usage, and troubleshooting: **[docs/INSTALL.md](docs/INSTALL.md)**.

Requirements: Node.js 18+ for the installer and preflight. The kit itself is Markdown — manual
install works with no runtime at all.

## Use it

After installing, in your agent:

> Initialize the Adaptive Mastery System for this repository. Inspect existing documentation first,
> verify it against the implementation, inventory every in-scope feature, build and review the
> chronological learning curriculum, then prepare the first learning unit.

Then, for later sessions:

> Continue my codebase mastery curriculum from the saved checkpoint. Teach the next not-yet-understood
> unit. Use the approved guide and reviewer notes, adapt to my understanding, and update progress.

For one scope:

> Teach Scope 18 using the Adaptive Mastery System. If its guide or review is missing or stale,
> inspect the source and rebuild/review it before teaching.

## What it produces

```text
docs/learning/
  README.md                    # how to navigate the library
  CURRICULUM.md                # ordered path, prerequisite rationale, coverage
  feature-register.yaml        # every in-scope feature, evidence status, exclusions
  progress.json                # resume checkpoint, learner model, phase timings
  features/001-<slug>.md       # one reviewed guide per learning unit
  reviews/001-<slug>.review.md # scores, findings, revision history, verdict
  source-maps/001-<slug>.md    # implementation trace and claim-to-evidence index
```

An existing `docs/` convention is respected rather than replaced.

## How it works

```text
Repository + existing docs
        │
        ▼
Inventory + evidence map          ← Repository Analyst
        │
        ▼
Feature register + dependency map
        │
        ▼
Chronological curriculum          ← Curriculum Planner
        │
        ▼
Draft a source-grounded guide     ← Lesson Author
        │
        ▼
Mechanical preflight              ← tools/preflight-review.mjs
        │
        ▼
Independent review                ← Independent Reviewer
        │
        ├── fails ──► targeted revision ──► delta review ──┐
        │                                                  │
        └──────────────── passes ◄─────────────────────────┘
        │
        ▼
Approved guide + review record + checkpoint
        │
        ▼
Teach progressively, adapt to the learner, update the model
```

Five roles, deliberately separated so the author never grades their own work:
**Orchestrator**, **Repository Analyst**, **Curriculum Planner**, **Lesson Author**,
**Independent Reviewer**. If your harness has no subagents, they run as distinct passes.

## Why review is fast without lowering the bar

Review is the only phase that repeats per unit *and* per revision round, so it dominates a long run.
The kit makes it cheap in the parts that are not judgment:

| Stage | Cost | What it settles |
|---|---|---|
| Preflight | seconds, no model | dead paths, dead anchors, missing sections, gate arithmetic |
| Evidence pack | inlined | following a reference becomes a read, not a tool round trip |
| Layered review | one pass | the lesson is simulated as a beginner; the reference appendix is checked, not performed |
| Fail fast | partial pass | a guide that cannot pass returns immediately with the findings that justify it |
| Delta rounds | changed only | re-scores affected criteria; each round must strictly reduce open findings |

Budgets for reference reads, extra source inspections and findings live in
`config/mastery-system.yaml`. They bound review mechanics, never explanation depth.

```bash
node tools/preflight-review.mjs docs/learning/features/001-upload.md
```

## Commands

| Command | Purpose |
|---|---|
| `adaptive-mastery init` | vendor the kit and wire it into your harness |
| `adaptive-mastery doctor` | verify install health, file drift, version skew |
| `adaptive-mastery update` | re-sync after upgrading, preserving your edits outside markers |
| `adaptive-mastery uninstall` | remove managed files and blocks |
| `node tools/preflight-review.mjs <guide>` | deterministic review preflight |

All installer commands accept `--target`, `--dry-run`, `--json`, `--quiet`.

## Repository layout

```text
SKILL.md                    # top-level behaviour and activation
agents/                     # the five roles + handoff contract
workflows/                  # bootstrap, authoring, review loop, teach/resume
templates/                  # feature guide, review report, register, progress
config/                     # system settings and learner profile
tools/                      # preflight (Node implementation + PowerShell shim)
install/                    # cross-platform CLI, injected block, Cursor rule
tests/                      # installer and preflight tests
docs/INSTALL.md             # installation guide
```

## Quality gate

A guide is teachable only when the reviewer confirms:

- repository claims are supported by inspected evidence;
- purpose and failure context are clear before internal details;
- prerequisites and unfamiliar terms arrive in an order that does not overload;
- cause and effect are followable;
- ordering matches actual behavior and dependencies;
- uncertainty is labelled, not smoothed over;
- the guide supports reasoning and prediction, not just recognition of terms.

Scored 0–4 per criterion, with hard minimums and an average threshold enforced by
`config/mastery-system.yaml` and recomputed exactly by the preflight. No fixed word count, step
count, or response-length cap.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Run `npm test` — 35 tests cover the installer and the
preflight, on Windows, macOS and Linux.

## License

MIT © Buezeth
