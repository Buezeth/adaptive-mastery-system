---
name: adaptive-mastery
description: Use when a user wants to understand a codebase, project, technical system, or AI diff in a way that builds durable understanding. Reads the vendored kit in {{DIR}}/.
---

# Adaptive Mastery System (v{{VERSION}} Pointer Stub)

This skill is a lightweight pointer to the immutable kit vendored at `{{DIR}}/` in the project root.

1. Read `{{DIR}}/SKILL.md` for full activation rules, capability fallbacks, and workflow steps.
2. Load the active role instructions from `{{DIR}}/agents/` and matching workflow from `{{DIR}}/workflows/`.
3. Run `node {{DIR}}/tools/preflight-review.mjs <guide> --emit-pack` before any Independent Reviewer pass (or follow `{{DIR}}/references/manual-preflight-checklist.md` if shell execution is unavailable).
4. Never edit files inside `{{DIR}}/`; persist mutable learner state and overrides in `docs/learning/learner-profile.yaml`, `docs/learning/config.local.yaml`, and `docs/learning/progress.json`.
