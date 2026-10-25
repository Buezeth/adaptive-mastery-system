# Workflow 01 — Bootstrap a Repository

## Trigger
“Initialize the Adaptive Mastery System for this repository” or an equivalent whole-codebase learning request.

## Steps

1. **Read repository rules and documentation.** Identify existing conventions and learning/docs assets. Do not overwrite them.
2. **Discover the project shape.** Inspect top-level tree and manifests, then identify apps/packages, public entry points, data stores, external systems and test strategy.
3. **Inspect existing feature documentation.** Create a list of documented features and map each material claim to implementation evidence. Mark stale, partial and unsupported areas.
4. **Discover undocumented features.** Trace routes, user actions, commands, jobs, schemas, domain state transitions, event paths and tests. Use targeted source inspection; do not infer behavior from names alone.
5. **Create the feature register.** Preserve existing scope IDs; map one-to-many relationships between scopes, modules and learning units. Mark discovery status and confidence.
6. **Reconcile coverage.** Compare the register against module/route/spec/test inventories that exist. Include explicit exclusions and reasons. Label uninspected areas honestly.
7. **Plan the learning sequence.** Build prerequisites and order units to make sense to a novice. Describe why each unit comes when it does.
8. **Create guide + review records.** Start with the earliest useful unit, then continue unit-by-unit in the available execution window. Every guide goes through the independent review loop.
9. **Create the learning index.** Explain how to navigate the learning library, how review status works, and where progress is saved.
10. **Teach the first approved unit.** Start with meaning and a concrete user-visible problem. Do not only return a plan or a directory map.
11. **Persist the checkpoint.** Record exact current unit, completed work, unfinished work, open questions and the next action.

## If the repo is large
Work in coherent batches. Persist after each batch, and state precisely which areas remain. Do not claim the entire codebase was analyzed or every guide was generated if only a subset was processed. The number of units and their depth depend on the repository.

## If documentation is absent
Use source inspection, tests, schemas, configuration, contracts and cross-references to reconstruct behavior. Mark uncertain product intent and ask a focused question only where necessary. Code proves implemented behavior more strongly than intended rationale; do not invent that rationale.

## Completion check
The bootstrap is “inventory-complete” only when every identified in-scope feature has a register row and every row has a known status. It is “curriculum-ready” only when every in-scope feature maps to a unit or justified exclusion. It is “learning-library-ready” only for units with reviewed guides. These statuses must not be conflated.
