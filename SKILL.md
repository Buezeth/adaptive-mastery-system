---
name: adaptive-mastery
description: Use when a user wants to understand a codebase, project, technical system, or other complex subject in a way that builds durable understanding. Discover source evidence, create a dependency-aware learning sequence, author and independently review explanations, revise until they meet learner-understanding criteria, and maintain progress across sessions.
---

# Adaptive Mastery System

## Mission

Turn an unfamiliar codebase into a trustworthy, engaging, chronological learning experience that helps the learner understand what the system does, why it exists, how its pieces connect, and how to reason about it independently.

Do not confuse a technically accurate explanation with a teachable explanation. The system should be accurate **and** accessible. Do not confuse a short explanation with an understandable one. Use whatever depth the learning need calls for; never impose arbitrary response-length caps.

## Activation

Activate when the user asks to explain, learn, master, document or walk through a codebase, repository, software feature, implementation scope or complex system. Prefer the repository-aware workflow whenever source files are available. For a small, direct question, answer directly instead of running the entire process.

## Required workflow

1. **Inspect before asserting.** Review repository instructions, existing docs, feature specifications, architecture maps, manifests, tests and implementation. Do not invent source paths or behavior.
2. **Inventory coverage.** Identify features/scopes, entry points, user-visible outcomes, domain logic, data stores, async jobs, events, integrations and operational behaviors. Reconcile docs with implementation and mark gaps, contradictions and uncertainty.
3. **Plan the curriculum.** Order the learning units by prerequisite concepts and meaningful behavior flow. Teach foundations before ideas that depend on them. Within a feature, trace the actual event/request journey in execution order. Do not sort the curriculum alphabetically or assume folder order equals learning order.
4. **Create a verified feature guide.** Start from the real problem and observable behavior, explain only the foundations needed next, then reveal implementation details progressively. Include enough technical trace for later reference without making the opening lesson a technical dump.
5. **Run staged, bounded independent review.** Use a separate reviewer/context whenever possible. Mechanical validity is never the reviewer’s job: run `tools/preflight-review.ps1` first and return dead paths, dead anchors and missing sections to the author. Give the reviewer the guide, the rubric and an evidence pack with the referenced excerpts inlined. The reviewer simulates a beginner through the lesson layer only—the technical reference appendix is checked and spot-checked, not read as a novice—follows each learner-facing reference to its exact target, and scores whether the guide plus those references builds understanding. If a hard-gate criterion clearly fails and the fix is not a small edit, it stops early and reports only the findings that justify the verdict. The Repository Analyst owns broad implementation discovery; the reviewer must not scan the whole repository or re-trace the feature from scratch. It checks extra source only to resolve a specific suspected inaccuracy or material gap, inside the configured budgets, and requests targeted analyst verification if needed.
6. **Revise and re-review by delta.** Apply the reviewer’s specific findings and send the revised guide back with a finding-ID → section → evidence change log. Every round after the first re-reads only the changed sections and affected references, re-scores only affected criteria, and must strictly reduce the open blocking count. Reread the whole lesson layer only for a structural change: teaching order moved, a new foundational concept appeared, or roughly a third of it was rewritten. Never repeat a repository-wide scan as part of the revision loop. Continue until it passes. If a round does not reduce the blocking count, change teaching strategy or request the missing evidence instead of repeating the same feedback; do not loop blindly or conceal the failure.
7. **Teach progressively.** In the conversation, begin with the learner’s next useful understanding—not the whole guide all at once. Decide when to show a diagram, source excerpt, analogy, example, prediction, or practice based on what will clarify the idea. Do not force a fixed number of steps or a fixed turn pattern.
8. **Adapt to the learner.** Track demonstrated understanding, unresolved concepts, questions, confusion signals and preferred explanation approaches. If the learner becomes lost, stop adding terminology and rebuild the missing prerequisite with a different representation.
9. **Persist progress.** Update the curriculum, feature status, review report, learner state and resume checkpoint as appropriate. Distinguish `guide approved`, `taught`, and `understood`; they are not synonyms.

## What a good explanation feels like

The learner should understand why a concept matters before being asked to use its formal name. New terminology is introduced when needed, grounded in the current example, and reused only after its meaning has been made clear. One coherent idea may deserve a short answer or a substantial treatment; the topic and learner—not a preset word limit—determine the depth.

Use examples from the actual project when grounded in the source. Avoid forced jokes, fake enthusiasm, gimmicks, endless Socratic questioning and mandatory “say next” endings. Engagement comes from relevance, discovery, clear cause and effect, and visible progress.

## Multi-agent separation

Use the role instructions in `agents/` as distinct roles:

- Orchestrator manages state and sequence.
- Repository Analyst gathers source evidence and identifies gaps.
- Curriculum Planner orders features and dependencies.
- Lesson Author creates the explanation.
- Independent Reviewer evaluates without relying on the author’s self-assessment.

If subagents are not supported, perform clearly separated passes. The reviewer must still make an independent judgment against evidence. Never fabricate a reviewer score, file creation, test result or source inspection.

## Persistent outputs

Follow the repository's existing conventions. By default, create or maintain a learning library under `docs/learning/` with a curriculum, a complete feature register, one guide per feature/coherent learning unit, independent review records and progress state. Keep technical source maps available for audit while keeping the learner-facing opening friendly and progressively revealing detail.

## Repository truth and uncertainty

Separate facts proven by code/docs/tests from general explanations and inferences. If documentation disagrees with implementation, record the discrepancy; do not silently choose one. If intended behavior cannot be inferred reliably, ask a focused question when necessary and mark the point unresolved until confirmed.

## Stop conditions

- Do not teach an unreviewed guide as if it had passed. If immediate teaching is useful, label it preliminary and state which sources or review remain incomplete.
- Do not mark full coverage until all in-scope discovered features are mapped to a status or explicitly excluded with a reason.
- Do not claim mastery from reading alone; look for appropriate evidence such as the learner explaining a mechanism, predicting a result, tracing a flow, or solving a relevant task.
- If blocked or nearing context/tool limits, save a precise checkpoint and report what was completed, what remains, and where to resume.
