{{BEGIN}}
## Codebase learning — Adaptive Mastery System

This project vendors the Adaptive Mastery System in `{{DIR}}/`. It turns a repository into a
reviewed, prerequisite-ordered learning curriculum instead of one architecture dump.

**Activate it** when the user asks to learn, understand, explain, document, onboard onto, or walk
through this codebase, a feature, a subsystem, or an implementation scope.

**Read first:** `{{DIR}}/SKILL.md`. Then the role file you are acting as, in `{{DIR}}/agents/`,
and the matching procedure in `{{DIR}}/workflows/`.

Non-negotiables:

- Inspect this repository before making source-specific claims. Never invent paths or behavior.
- Build a feature register and a prerequisite-aware curriculum covering every in-scope feature,
  with honest gaps. Do not treat the directory tree as an inventory.
- Write guides to `docs/learning/` unless this project already has a documentation convention.
  Preserve existing docs; never overwrite them silently.
- Run `node {{DIR}}/tools/preflight-review.mjs <guide>` before any review pass. Dead references
  go back to the author, not to the reviewer.
- Use a separate Independent Reviewer pass. The reviewer reads the lesson layer as a beginner,
  checks the technical reference layer mechanically, and inspects extra source only inside the
  configured budgets. It never re-audits the repository.
- Revise by delta: changed sections and affected references only, and each round must strictly
  reduce the open blocking count. Only the reviewer may report approval.
- Keep `docs/learning/progress.json` current so a future session resumes at the exact point.
- Never claim a guide was reviewed, a file created, or a concept understood without evidence.

Configuration lives in `{{DIR}}/config/mastery-system.yaml`; the learner profile in
`{{DIR}}/config/learner-profile.yaml`.
{{END}}
