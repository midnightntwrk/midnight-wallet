---
paths:
  - 'packages/**/*.ts'
---

# Functional style — hard rules

Mandatory for all SDK code. Rationale and worked examples: `docs/CodingConventions.md`.

## Immutability

- `const` only — never `let`. No `for`/`while` loops — use `map`/`filter`/`reduce`/`flatMap`.
- No mutation: no `push`/`pop`/`splice`, no `obj[key] = value`. Build new values with spread.
- Exceptions (rare, must be isolated and justified): measured performance bottlenecks, inherently mutable external APIs,
  test setup/teardown.

## Either vs Effect — never interchangeable

- `Either` = pure synchronous computation: validation, state transformations, business logic.
- `Effect` = side effects: I/O, async, resources, dependency injection.
- Never wrap pure logic in Effect. Convert at the boundary only: `EitherOps.toEffect`
  (`packages/utilities/src/EitherOps.ts`).

## Types

- Parse, don't validate: `parse(input): ValidType | Error`, never `validate(input): boolean`. Use branded types
  (`effect/Brand`) to keep similar primitives apart.
- Make illegal states unrepresentable: tagged unions (`Data.taggedEnum`) over optional-field bags.
- Total functions: `Option` for absence, `Either`/`Effect` for failure. Never throw for expected errors (exception:
  facade APIs translate to Promise/RxJS per ADR 0006).
- No `as` casts without exhausting alternatives first; a necessary cast requires a
  `// Type cast required because: <reason>` comment.

## Effect usage

- Import aliases for globals-shadowing modules (language-service enforced):
  `Array→EArray, Record→ERecord, Number→ENumber, String→EString, Boolean→EBoolean, Function→EFunction`.
- `Effect.gen` for multi-step sequential logic with intermediate values; `pipe` for linear chains. Never `Effect.gen`
  for a single operation. Don't mix both styles in one function.
- Errors: one `Data.TaggedError` per failure mode, composed as unions, handled exhaustively (`$match`/`Match`) — never a
  thrown exception or a boolean result.
- Check Effect's stdlib before writing utilities (`effect/Array`, `effect/Function`, `effect/Match`, `effect/HashMap`,
  `effect/Schema`, …) — many problems are already solved.

## State

- State lives in refs (`SubscriptionRef`/`SynchronizedRef`); pure functions transform it; services orchestrate. Update
  only via `Ref.update`/`Ref.modify` with a pure function, using only the state passed into the callback. Never pair a
  separate `get` with a write — that's a race.
- RxJS `Observable`s appear only in APIs exposed to SDK users; internals use Effect streams/refs.

## Public API documentation

- Public APIs require JSDoc: description, `@param` for each parameter, `@returns`, `@throws` (facade APIs that throw),
  and an `@example` with a working snippet (worked example: `docs/CodingConventions.md` → Documentation Standards).

## Downstream impact

| If you change...           | Impact                              | Action                                      |
| -------------------------- | ----------------------------------- | ------------------------------------------- |
| `abstractions/` interfaces | All wallet implementations break    | Breaking change — coordinate before merging |
| `facade/` public API       | All SDK consumers break             | Major version bump, changeset required      |
| `capabilities/`            | All wallet implementations affected | Run full test suite                         |
| `utilities/`               | Everything depends on it            | Run full test suite                         |
| `runtime/` variant pattern | Wallet lifecycle affected           | Test variant migration paths                |

## Where the patterns live

Canonical files: trait/dictionary passing `packages/capabilities/src/pendingTransactions/pendingTransactions.ts`; pure
state transforms `packages/unshielded-wallet/src/v1/UnshieldedState.ts`; Either utilities
`packages/utilities/src/EitherOps.ts`; tagged enums `packages/runtime/src/abstractions/StateChange.ts`; branded types
`packages/abstractions/src/ProtocolVersion.ts`; parse-don't-validate `packages/address-format/src/index.ts`.
