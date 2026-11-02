---
unit_id: "calibration-bad-001"
unit_order: 1
introduces:
  - transactional outbox
  - lease
  - polling
  - idempotency
assumes:
  - distributed lock manager
---

# 001 — Lease-Based Batch Polling & Redis Handoff

> **Calibration fixture:** This file is a permanent known-bad guide used to verify that both `tools/preflight-review.mjs` and the Independent Reviewer fail explanations that stack unexplained jargon (`outbox`, `Redis`, `lease`, `polling`, `idempotency`) before establishing the user problem.

## What this helps the user do
This subsystem implements a transactional outbox with Redis handoff, lease-based batch polling, BullMQ workers, and idempotency keys to guarantee at-least-once delivery across worker processes.

## Why the feature needs to exist
Without a lease timeout and transactional outbox table, concurrent polling loops could double-enqueue Redis jobs during worker failover.

## The first idea to understand
The worker acquires a lease row in PostgreSQL, polls the outbox batch, and pushes serialized payloads to Redis with an idempotency token.

## Follow one real example through the system
A cron tick invokes the batch poller, which locks rows and enqueues them.

## How the implementation makes it happen
See `SKILL.md` for repository instructions.

## What happens when things do not go as expected
Expired leases are reclaimed on the next polling tick.

## How this connects to the rest of the codebase
Connects the database layer to the worker queue.

## Technical reference

Entry points and worker configuration.

## Evidence and confidence

| Claim | Evidence (exact file/symbol/lines or document heading/section) | Evidence type | Confidence / caveat |
|---|---|---|---|
| Known-bad calibration fixture | `SKILL.md` | docs | high |

## What you should now be able to reason about
Why this guide fails both mechanical preflight (missing prerequisite `distributed lock manager` and premature jargon in `What this helps the user do`) and pedagogical review (Criteria 2, 3, and 4 score `<= 1`).
