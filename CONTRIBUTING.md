# Contributing

Thanks for improving the Adaptive Mastery System. This repository is mostly instructions, so the
bar for changes is *evidence and clarity*, not code volume.

## Setup

```bash
git clone https://github.com/Buezeth/adaptive-mastery-system.git
cd adaptive-mastery-system
npm test
```

No dependencies. Node 18+ only.

## What the tests cover

| File | Covers |
|---|---|
| `tests/install.test.mjs` | init, idempotency, harness adapters, dry-run, update safety, doctor, uninstall, refusal cases |
| `tests/preflight.test.mjs` | reference extraction, anchor validation, layer split, gate arithmetic |

If you change the installer's on-disk behaviour or the preflight's output shape, change the tests in
the same commit. `install.json` and the preflight JSON are public contracts — the workflow docs and
the review template read them.

## Adding a harness

1. Add the name to `HARNESSES` in `install/cli.mjs`.
2. Teach `detectHarnesses` how to recognise it.
3. Write its adapter in `writeAdapters` and add it to `uninstall` and `doctor`.
4. Add a test that installs only that harness and asserts the file it writes.
5. Document the trigger and the file in `docs/INSTALL.md` and `README.md`.

Adapters must be idempotent and must never modify content outside their own markers or files.

## Changing the review policy

The review rules are intentionally stated in several places — `SKILL.md`, `AGENTS.md`,
`agents/00-orchestrator.md`, `agents/04-independent-reviewer.md`, `workflows/04-*.md`,
`agents/HANDOFF_CONTRACT.md`, and `config/mastery-system.yaml`. When you change a rule, update every
copy in the same commit, or the instructions will contradict each other at the exact moment an agent
is choosing which one to follow.

Any new limit must bound **review mechanics** (tool calls, reads, findings per report), never
explanation depth. The kit deliberately has no word, step, or concept caps.

## Style

- Prefer a concrete rule over an adjective. "At most 5 blocking findings" beats "be concise".
- State the cost a rule protects against, in one clause. Future readers delete rules whose purpose
  is invisible.
- Do not add network calls, runtime dependencies, or telemetry to the installer.
- Keep the kit usable without Node: everything in `agents/`, `workflows/`, `templates/`, and
  `config/` must stay plain Markdown/YAML.

## Versioning

Semantic versioning. A change to the injected `AGENTS.md` block or the `install.json` schema is a
minor bump at least; a change that breaks existing installations is a major bump. Record every
user-visible change in `CHANGELOG.md`.

## Pull requests

- One concern per PR.
- `npm test` green on your platform. CI covers Windows, macOS and Linux across Node 18–24.
- If you changed a behaviour described in the README or `docs/INSTALL.md`, update the prose.
