# Parked — systemwide redundant policy-lookup finding (UNVERIFIED)

**Status: not board state. Not in TASKS.md. Not in DECISIONS.md. Do not build on this
without re-verifying it first, in a fresh session with its own scope.**

## What was reported (from a separate session, not this one)

A read-only diagnostic in a different conversation window reported that ~49% of ALL
policy lookups (144/293, systemwide) are redundant — they fire on emails whose order
already has a resolved return window, because extraction runs pre-link and can't see
order-level state at the time a given email is processed. Non-Amazon retailers were
reported slightly worse than Amazon on this measure.

## Why this file exists instead of a board entry

This session did not run that diagnostic, has not seen its underlying query or raw
output, and cannot vouch for the 144/293 figure. The originating session's own framing
called it "inferred + a floor, not a verified figure — must be firmed before any build."
Treating an unverified cross-session claim as settled board state would risk building
against a number nobody in this session confirmed.

`scripts/census-redundant-policy-lookup.ts` exists (untracked) and is presumably the
source of this number — also unverified here, not re-run as part of parking this note.

## Before this becomes real scope

- Re-run (or re-derive) the redundancy count from scratch in its own session, with its
  own read-only Step 0, the same way the Amazon return-window task was scoped.
- Confirm the 144/293 figure, or get a corrected one.
- Confirm the "extraction runs pre-link" mechanism claim against the actual code path
  (`lib/extract.ts` / `lib/linkOrder.ts` ordering), not just take it as given.
- Only once verified: decide whether it becomes a `TASKS.md` 🔴 Now item.
