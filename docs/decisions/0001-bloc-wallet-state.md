# BLoC pattern for push-based notifications of state updates

_Note: This ADR was written with the original Scala implementation in mind, but the principles and decision rationale remain relevant for the current TypeScript implementation._

Technical Story: [PM-5500](https://input-output.atlassian.net/browse/PM-5500)

## Context and Problem Statement

The objective of this change is to pay the tech debt from the decision taken on another change, so
the context and problem statement is still the same.
See [ADR-0005](0005-wallet-balance-observable.md).

## Decision Drivers

The decision drivers are the same as in `ADR-0005`, except for time which is no longer a concern:

* Simplicity of implementation.
* How many third-party dependencies are needed.
* Reusability.
* Testability.

## Considered Options

The considered options are also the same as in `ADR-0005`, except for options **5** and **6** which,
without time as a decision driver, don't even qualify as options.

1. Use **monix-reactive** and implement a _Bloc_ pattern similar to what was done in Mocked Node.
2. Use **fs2** `Topic` to implement publish-subscriber.
3. Use **cats-effect** primitives to implement publish-subscriber.
4. Reuse Mocked Node's `bloc` module.

## Decision Outcome

Chosen option: **2**: "Use **fs2** `Topic` to implement publish-subscriber", because it satisfies
all the decision drivers.

### Positive Consequences

* We already have fs2 as a dependency so there's no extra third-party dependency to add.
* fs2 interacts nicely with cats and cats-effect, making this implementation flexible for future
  improvements.
* Implementation is fairly simple (less than 100 lines of code) and easy to test
* This is highly reusable because it works for Scala on JVM and Scala.js, and thus it's easy to
  package for Javascript and Typescript
* It's idiomatic for Scala developers

**Note:** In `ADR-0005` it was stated that _`Topic` is meant to be pull-based meaning that the
producer (the one that updates local state with transactions) would be blocked if consumers can't
keep up_. But this isn't true with newer fs2 versions that expose a `Topic.subscribeUnbounded`
method, with which we can implement a push-based API without workarounds.

## Pros and Cons of the Options

Pros and cons also stay the same for the rest of the options as in `ADR-0005`.

## Links <!-- optional -->

* [ADR-0005](0005-wallet-balance-observable.md)
