# How to expose wallet balance

Technical Story: [PM-5282](https://input-output.atlassian.net/browse/PM-5282)

## Context and Problem Statement

We need to:
1. Keep the local state up to date, by applying transactions as they are received from node.
2. Read the local state from time to time, to fulfill the user-initiated action of balancing a transaction request.
3. Expose an observable-like API that notifies subscribers each time there is an update.
In particular this will be used to expose total balance API.

For `1` we already have the `SyncClient` which gives us a stream of blocks, and we can drain and update the local state.
For `2`, keeping local state in a `cats.effect.Ref` would be enough, because it's enough that the
user takes a snapshot of the local state at certain moment and builds a transaction based on that state.

For `3` it's a bit more tricky. Because just a `Ref` doesn't allow us to push events when the state
is updated. The ideal candidate would be an actual implementation of the reactive _Subject_ pattern.
So the question is what would be the best approach to solve `3`.

## Decision Drivers

* **Time:** At the moment of writing this, there's little more than 1 week before the delivery deadline.
* Simplicity of implementation.
* How many third-party dependencies are needed.
* Reusability.
* Testability.

## Considered Options

1. Use **monix-reactive** and implement a _Bloc_ pattern similar to what was done in Mocked Node.
2. Use **fs2** `Topic` to implement publish-subscriber.
3. Use **cats-effect** primitives to implement publish-subscriber.
4. Reuse Mocked Node's `bloc` module.
5. Keep a simple `Ref` and fake the `Observable` API by polling this `Ref` in some time intervals.
6. Not expose `Observable` but just a `Promise` and leave it up to clients to poll for updates.

## Decision Outcome

Chosen option **5**: "Keep a simple `Ref` and fake the `Observable` API by polling this `Ref` in some time intervals",
because it's the second-most easy to implement and the time limitation is the key decision driver here.
Option **6** would be viable, but it's very little extra effort required to bring an `Observable` API,
and it already sets up the API for the future.

### Positive Consequences

* Very simple implementation, which is not only easy to implement but easy to debug in case of issues.
* Doesn't require adding extra third-party dependencies.

### Negative Consequences

* This solution is a stopgap, it's not future-proof and will require a refactor.
* Efficiency: Polling generates unnecessary state queries when there are no changes, and at the same time
might miss intermediate states in between queries.

## Pros and Cons of the Options

### Use `monix-reactive` to implement _Bloc_

See the documentation [here](https://monix.io/docs/current/#monix-reactive).

* Good, because it provides what we need almost out of the box
* Good, because it's cross built for Scala 2 and 3 and Scala.js
* Bad, because adds more dependencies, since we base everything on cats/cats-effect.
* Bad, because it puts in danger the future of the Wallet if we have many libraries for the same thing.
* Bad, because right now the maintenance of Monix is being questioned.

### Use `fs2` to implement publish-subscriber

See the documentation [here](https://fs2.io/#/concurrency-primitives?id=topic).

* Good, because we are already using fs2
* Good, because fs2 is stable and interacts nicely with cats and cats-effect
* Bad, because `Topic` is meant to be pull-based meaning that the producer (the one that updates
local state with transactions) would be blocked if consumers can't keep up
* Bad, because it would require a big amount of workarounds to make it push-based

### Use `cats-effect` primitives to implement publish-subscriber

See the documentation [here](https://typelevel.org/cats-effect/docs/getting-started)

* Good, because we are already using cats-effect
* Good, because it could be a very customized solution for our needs
* Bad, because the implementation can be potentially complex
* Bad, because it's a bit of re-implementing the wheel

### Reuse Mocked Node's `bloc` module

Implementation can be found [here](https://github.com/midnightntwrk/midnight-mocked-node/tree/main/packages/bloc).

* Good, because it reuses existing code
* Good, because we get new features "for free" when they're implemented for the Mocked Node
* Bad, because it might need some facades to interop easily with `rxjs`
* Bad, because it wouldn't be available for Scala on JVM
* Bad, because it wouldn't be idiomatic Scala code that can be easily maintained by Scala devs

### Not expose `Observable`

* Good, because it's the easiest thing we can do, in the shortest time
* Bad, because it's a stopgap that will need a refactor
* Bad, because it sets up an API that we know will change soon
* Bad, because it will require a change breaking the API soon
