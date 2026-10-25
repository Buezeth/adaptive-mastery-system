# Installing Adaptive Mastery System

The kit is a set of instructions and one small CLI. Installing it means two things:

1. vendoring the kit into your project at `.adaptive-mastery/`;
2. adding a short managed block to the instruction file your agent already reads
   (`AGENTS.md`, `CLAUDE.md`, or a Cursor rule).

Nothing else in your project is modified. There is no build step, no dependency install, and no
telemetry.

## Requirements

| Requirement | Why | Without it |
|---|---|---|
| Node.js 18+ | Runs the installer and the review preflight | You can still install by copying, but `preflight` and `doctor` are unavailable |
| git | Nothing — optional | — |
| An agent harness that reads project instructions | Consumes the kit | The vendored files are inert |

The kit itself is Markdown and YAML. Node is only needed for the installer and the deterministic
preflight.

## Option A — npx (recommended)

From your project root:

```bash
npx adaptive-mastery init
```

The installer auto-detects which harness you use. To be explicit:

```bash
npx adaptive-mastery init --harness claude
npx adaptive-mastery init --harness agents,cursor
```

## Option B — global install

```bash
npm install --global adaptive-mastery
adaptive-mastery init
```

## Option C — from a clone

```bash
git clone https://github.com/Buezeth/adaptive-mastery-system.git
cd adaptive-mastery-system
./install.sh --target /path/to/your/project        # macOS / Linux
```

```powershell
git clone https://github.com/Buezeth/adaptive-mastery-system.git
cd adaptive-mastery-system
./install.ps1 -Target C:\path\to\your\project      # Windows
```

Both wrappers only forward to `node install/cli.mjs`.

## Option D — manual copy (no Node)

Copy these into your project:

```text
your-project/
  .adaptive-mastery/
    SKILL.md
    agents/
    workflows/
    templates/
    config/
    references/
    tools/
```

Then append `install/block.md` to your `AGENTS.md`, replacing `{{DIR}}` with `.adaptive-mastery`
and `{{VERSION}}` with the version you copied. The block's start and end markers matter: they are
what makes later updates idempotent.

The preflight will not run in this mode. That costs speed, not correctness — the reviewer falls
back to checking references by hand.

## What gets written

```text
your-project/
  .adaptive-mastery/            # the vendored kit, replaced on update
    SKILL.md
    agents/  workflows/  templates/  config/  references/  tools/  docs/
    install.json                # version, harnesses, per-file hashes
  AGENTS.md                     # one managed block appended or updated
  CLAUDE.md                     # only with the claude harness
  .claude/skills/adaptive-mastery/   # only with the claude harness
  .cursor/rules/adaptive-mastery.mdc # only with the cursor harness
```

`docs/learning/` is **not** created by the installer. The agent creates it when you first run the
system, after checking your repository's existing documentation conventions.

## Harnesses

| Harness | Trigger | Writes |
|---|---|---|
| `agents` | `AGENTS.md` exists, or the project is a git repo | managed block in `AGENTS.md` |
| `claude` | `.claude/` or `CLAUDE.md` exists | self-contained skill at `.claude/skills/adaptive-mastery/` plus a `CLAUDE.md` block |
| `cursor` | `.cursor/` exists | `.cursor/rules/adaptive-mastery.mdc` |

Auto-detection falls back to `agents` when nothing is found. `--harness all` writes all three.

The Claude skill is vendored as a full copy next to its `SKILL.md` because skills resolve their
supporting files relative to themselves. This is deliberate duplication of installed artifacts, not
a second source of truth: `update` regenerates both.

## Verify, update, remove

```bash
adaptive-mastery doctor      # exit 0 = healthy; reports file drift, missing blocks, version skew
adaptive-mastery update      # re-sync after upgrading the package
adaptive-mastery uninstall   # remove managed files and blocks, leave your content alone
adaptive-mastery version     # package version and installed version
```

Every command accepts `--target <dir>`, `--dry-run`, and `--json`. `doctor` and `preflight` set
non-zero exit codes, so both work in CI.

### Updating without losing your edits

- Content **outside** the `<!-- adaptive-mastery:begin -->` / `<!-- adaptive-mastery:end -->`
  markers is never touched. Your own rules keep working.
- Content **inside** the markers is owned by the installer and will be replaced.
- If you edited a *vendored* file under `.adaptive-mastery/`, `update` refuses to overwrite it and
  lists what changed. Re-run with `--force` once you have moved your change somewhere durable.
  Local edits there do not survive an upgrade by design — fork the repository instead.

## Preview before writing

```bash
adaptive-mastery init --dry-run
```

Prints every action and writes nothing. Useful on a repository you cannot afford to disturb.

## Manual install safety

The installer refuses to run in three cases:

- the target does not exist;
- the target is the kit repository itself;
- a vendored file was modified locally and `--force` was not passed.

## Troubleshooting

**`error: Node.js 18+ is required`** — install Node, or use Option D. Check with `node --version`.

**`an installation already exists; use "update"`** — a manifest was found. This is a warning, not a
failure; `init` continues so that installation can be repaired. Prefer `update`.

**The agent ignores the kit** — confirm the block exists in the file your harness actually reads
(`AGENTS.md` for Codex-style tools, `CLAUDE.md` for Claude Code, `.cursor/rules/` for Cursor), then
restart the session so instructions are re-read.

**`doctor` reports missing blocks** — a formatter or a bad merge removed the markers. Run
`adaptive-mastery update` to re-inject them.

**Preflight exits 1 on a guide you just wrote** — it prints JSON with `references.missing` and
`references.broken_anchors`. Each entry names the line, the target, and why it failed. Fix those
before asking for a review.

## Using it in CI

```yaml
- run: npx adaptive-mastery doctor
- run: |
    for guide in docs/learning/features/*.md; do
      node .adaptive-mastery/tools/preflight-review.mjs "$guide" || exit 1
    done
```

Preflight exits `1` for a dead reference, a dead anchor, or a missing required section, and `2` for
a usage error. It never writes to the repository.
