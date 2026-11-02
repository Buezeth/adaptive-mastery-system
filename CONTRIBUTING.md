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
| `tests/install.test.mjs` | init, idempotency, registry harnesses (including Windsurf frontmatter & Aider `.aider.conf.yml`), pointer stubs, vendored CLI execution without `package.json`, standalone `print`/`bundle`, `calibrate`, kit/state split, CRLF hash normalization, harness union on `init` & `update`, adapter modification guards, pre-existing empty file preservation (`created` flag), doctor, uninstall |
| `tests/preflight.test.mjs` | reference extraction (`:line`, `#L10`, comment-aware `-> symbol()`, `Makefile`; rejects vague directory links), fence tracking, duplicate `-1` anchors, template-body placeholder detection, required frontmatter (`introduces`/`assumes`/`terms`), populated `evidence_rows`, known-bad calibration fixtures, `--emit-pack`, delta scorecard, `## Guess log` enforcement, `### [F-xx]` finding count derivation, latest-transition convergence, self-reference-safe `guide_sha256`, region-scoped soft/hard staleness, `validate`, `calibrateReviewer` |
| `tests/policy.test.mjs` | guards against legacy PowerShell script references, unlinked skills, missing `PAYLOAD`/`package.json` files on disk, dead links/anchors across all kit markdown files, and threshold/budget/weight drift between `config/mastery-system.yaml` and the policy docs |
| `tests/novice.test.mjs` | standalone and fixture checks for `tools/novice-lint.mjs` (`tests/fixtures/novice-bad-virtual-scroll.md` vs `tests/fixtures/novice-good-virtual-scroll.md`, `terms` frontmatter, on-ramp code/link/fence bans, domain jargon watchlist, bold first mention, Flesch-Kincaid reading grade, everyday picture warning) |

If you change the installer's on-disk behaviour or the preflight's output shape, change the tests in
the same commit. `install.json` and the preflight JSON are public contracts — the workflow docs and
the review template read them.

## Adding a harness

1. Add a single entry to `HARNESS_REGISTRY` in `install/cli.mjs` (`id`, `detect`, `write`).
2. Add a test in `tests/install.test.mjs` that installs that harness and asserts the adapter it writes and removes.
3. Document the trigger and the file in `docs/INSTALL.md` and `README.md`.

Adapters must be idempotent, tracked in `manifest.adapter_hashes` with LF-normalized SHA-256 hashes,
and must never modify content outside their own markers or files.

## Changing the review policy

The review rules are stated in `SKILL.md`, `AGENTS.md`, `agents/00-orchestrator.md`,
`agents/04-independent-reviewer.md`, `workflows/04-independent-review-loop.md`,
`agents/HANDOFF_CONTRACT.md`, and `config/mastery-system.yaml`. When you change a rule or threshold,
update every copy in the same commit—`tests/policy.test.mjs` fails CI if the documented numbers
drift from `config/mastery-system.yaml`.

Any new limit must bound **review mechanics** (tool calls, reads, findings per report), never
explanation depth. The kit deliberately has no word, step, or concept caps.

## Style

- Prefer a concrete rule over an adjective. "At most 5 blocking findings" beats "be concise".
- State the cost a rule protects against, in one clause. Future readers delete rules whose purpose
  is invisible.
- Do not add network calls, runtime dependencies, or telemetry to the installer.
- Keep the kit usable without Node: everything in `agents/`, `workflows/`, `templates/`,
  `references/`, and `config/` must stay plain Markdown/YAML, with `references/manual-preflight-checklist.md`
  supporting no-shell environments.

## Versioning

Semantic versioning. A change to the injected `AGENTS.md` block or the `install.json` schema is a
minor bump at least; a change that breaks existing installations is a major bump. Record every
user-visible change in `CHANGELOG.md`.

Publishing is documented separately in **[docs/RELEASING.md](docs/RELEASING.md)** (which is excluded
from vendored installs and npm tarballs).

## Pull requests

- One concern per PR.
- `npm test` green on your platform. CI covers Windows, macOS and Linux across Node 18–24.
- If you changed a behaviour described in the README or `docs/INSTALL.md`, update the prose.
