# Installing Adaptive Mastery System

The kit is a set of instructions and one zero-dependency Node CLI. Installing it means three things:

1. vendoring the **immutable** kit into your project at `.adaptive-mastery/`;
2. seeding **mutable** user-owned config and learner state in `docs/learning/` (`config.local.yaml`, `learner-profile.yaml`, and `.gitignore`) **only if absent**, so kit updates never overwrite learner state;
3. wiring a short managed pointer block or rule file into the harness your agent already reads.

Nothing else in your project is modified. There is no build step, no dependency install, and no telemetry.

## Requirements

| Requirement | Why | Without it |
|---|---|---|
| Node.js 18+ | Runs the installer, `preflight`, and `validate` | Use `adaptive-mastery bundle` or manual copy, and follow `references/manual-preflight-checklist.md` |
| git | Used by `adaptive-mastery validate` for `git ls-files` coverage and diff mode | Falls back to directory walking |
| An agent harness | Consumes the kit | Use `adaptive-mastery print` or `adaptive-mastery bundle` for chat/web UIs |

## Option A — npx (recommended)

From your project root:

```bash
npx adaptive-mastery init
```

Directly from GitHub:

```bash
npx github:Buezeth/adaptive-mastery-system init
```

The installer auto-detects which harness(es) you use. To be explicit:

```bash
npx adaptive-mastery init --harness claude
npx adaptive-mastery init --harness agents,cursor,copilot
npx adaptive-mastery init --harness custom --file .my-agent/instructions.md
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
node install/cli.mjs init --target /path/to/your/project
```

## Option D — universal fallbacks (`custom`, `print`, `bundle`, manual copy)

For any unknown or web-based harness:

- **Inject into any custom instruction file:**
  ```bash
  npx adaptive-mastery init --harness custom --file path/to/instructions.md
  ```
- **Print the managed block to stdout (for "custom instructions" textboxes):**
  ```bash
  npx adaptive-mastery print
  ```
- **Generate a single self-contained `ADAPTIVE_MASTERY.md` bundle (for chat UIs without repo filesystem access):**
  ```bash
  npx adaptive-mastery bundle --out ADAPTIVE_MASTERY.md
  ```

## What gets written

```text
your-project/
  .adaptive-mastery/                 # immutable vendored kit, replaced on update
    SKILL.md  CURRICULUM_FORMAT.md
    agents/  workflows/  templates/  config/  references/  tools/  install/
    install.json                     # version, harnesses, LF-normalized hashes for kit + adapters
  docs/learning/                     # mutable user state (created only if absent, never overwritten)
    config.local.yaml                # project overrides for mastery-system.yaml
    learner-profile.yaml             # active learner preferences and feedback
    .gitignore                       # ignores progress.json and learner-profile.yaml by default
  AGENTS.md                          # canonical managed block (when agents harness is active)
  CLAUDE.md                          # pointer block (when AGENTS.md is active) or full block
  .claude/skills/adaptive-mastery/SKILL.md  # lightweight pointer skill stub
  .cursor/rules/adaptive-mastery.mdc        # only with cursor harness
```

## Supported harnesses (registry-driven)

| Harness | Auto-detect trigger | Writes |
|---|---|---|
| `agents` | `AGENTS.md` exists (or fallback when none match) | managed block in `AGENTS.md` |
| `claude` | `.claude/` or `CLAUDE.md` exists | pointer skill at `.claude/skills/adaptive-mastery/SKILL.md` + `CLAUDE.md` block |
| `cursor` | `.cursor/` exists | `.cursor/rules/adaptive-mastery.mdc` |
| `copilot` | `.github/copilot-instructions.md` exists | managed block in `.github/copilot-instructions.md` |
| `gemini` | `GEMINI.md` or `.gemini/` exists | managed block in `GEMINI.md` |
| `windsurf` | `.windsurf/` or `.windsurfrules` exists | `.windsurf/rules/adaptive-mastery.md` |
| `cline` | `.clinerules` exists | `.clinerules/adaptive-mastery.md` |
| `aider` | `.aider.conf.yml` exists | managed block in `CONVENTIONS.md` |
| `custom` | `--harness custom --file <path>` | managed block in `<path>` |

When both `AGENTS.md` and `CLAUDE.md` are installed (or when `CLAUDE.md` already imports `@AGENTS.md`), `CLAUDE.md` receives a lightweight pointer block referencing `@AGENTS.md` and `.adaptive-mastery/SKILL.md` so Claude Code never loads the full block twice.

## Commands: verify, preflight, validate, update, remove

```bash
adaptive-mastery doctor                    # verify kit + adapter hashes (LF-normalized)
adaptive-mastery preflight <guide.md>      # Stage-0 mechanical preflight (--emit-pack, --review-report)
adaptive-mastery validate                  # validate progress.json, feature-register.yaml, staleness & coverage
adaptive-mastery update                    # re-sync kit and union harnesses, keeping user state untouched
adaptive-mastery uninstall                 # remove managed files/blocks (deletes 0-byte created files)
adaptive-mastery print                     # print managed block to stdout
adaptive-mastery bundle                    # write single-file ADAPTIVE_MASTERY.md bundle
adaptive-mastery version                   # package version and installed version
```

Every command accepts `--target <dir>`, `--dry-run`, `--quiet`, and `--json`.

### Updating without losing your edits or learner state

- **User state is separate from the kit:** `docs/learning/config.local.yaml`, `docs/learning/learner-profile.yaml`, and `docs/learning/progress.json` live outside `.adaptive-mastery/` and are never overwritten by `update` (even with `--force`) or deleted by `uninstall`.
- **Harnesses are unioned on update:** Running `adaptive-mastery update --harness cursor` on an existing `claude` install keeps both `claude` and `cursor` in the manifest.
- **Line-ending normalization:** All SHA-256 hashes normalize `\r\n` to `\n`, so `git config core.autocrlf true` on Windows never causes false drift in `doctor` or `update`.

## Using it in CI

```yaml
- run: npx adaptive-mastery doctor
- run: npx adaptive-mastery validate
- run: |
    for guide in docs/learning/features/*.md; do
      npx adaptive-mastery preflight "$guide" || exit 1
    done
```
