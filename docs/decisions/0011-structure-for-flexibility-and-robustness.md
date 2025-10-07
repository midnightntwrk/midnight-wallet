# Structure for flexibility and robustness with Variants, Builders and Facades

- Status: accepted
- Deciders: Andrzej Kopeć, Agron Murtezi, Tim Roberts
- Date: April 2025

Technical Story: [Wallet Rewrite](https://shielded.atlassian.net/browse/PM-13769)

## Context and Problem Statement

With the rewrite of Wallet from Scala into TypeScript, multiple questions emerged, aside from just rewritting needed
functionality:

- whether or not make some Rust code part of the wallet codebase?
- how to structure the code to provide a scalable basis for handling future hard-forks? Specifically - where and how to
  put abstractions so that each implementation of e.g. shielded tokens wallet can be provided in a separate, independent
  package, possibly even with a completely different API?
- how to structure the code to reduce cognitive load regarding all wallet functionality (unshielded tokens, shielded
  tokens, Dust...)
- how to structure the APIs so that the flexibility present internally can be accessed by the SDK users?

In Scala - a lot can be done with typeclasses, but in TypeScript - there is no direct replacement for this
functionality. Figuring out how to access needed implementation of a variant (implementation of a wallet compatible with
specific protocol version) and how to expose its API suddenly becomes a tricky problem.

## Decision Drivers

- Ability to scale the Wallet SDK codebase as new kinds of tokens and hard forks appear
- Ability to provide flexible APIs to support cases where adjustments are needed - e.g. faucet needs a coin selection
  allowing for maximum parallelism of transactions issued, or a wallet able to work with proof-erased transactions
- Ability to implement a facade API similar to the existing Scala one
- Maintain functional spirit of the codebase - specifically the separation between services (side-effecting, but not
  state-changing, implementations for interacting with outer world) and capabilities (pure implementations of
  functionalities, possibly returning new, updated Wallet state as a result of the operation) as indicated in
  [0007 Abstract over Wallet decision](./0007-abstract-over-wallet.md)
- Safely manage the state - specifically allow for implementation of the Bloc pattern as ADRs
  [0005](./0005-wallet-balance-observable.md) and [0006](./0006-bloc-wallet-state.md) indicate
- Get as much type-safety, as reasonably possible with TypeScript
- The implementation needs to feel somehow idiomatic in TypeScript

## Considered Options

There were different options considered at each axis.

### How to manage variant APIs

- Create a singular API, which all variants of a wallet would need to implement
- Let each variant implement its own API, let the facade code dispatch calls accordingly to the situation, providing
  single, unified API at the same time

### How to manage implementations of functionalities

- Gather all implementations through Effect's services, not separating capabilities and services
- Gather all implementations through a builder pattern independently from Effect's services, allowing to separate
  capabilities and services

### How to expose APIs and integrate them

- Expect Effect-based APIs at integration points, expose more idiomatic, Promise- and rx.js-based API at the facades
- Expect idiomatic, rx.js- and Promise-based API at integration points, expose such as well
- Expose and expect Effect-based APIs

## Decision Outcome

After some experiments and initial implementations, following options were chosen:

1. To not include any Rust code just yet. It might be reconsidered in the future, if a need arises or there is
   sufficient time to train TypeScript developers in Rust.
2. To manage variant APIs in a way, where each variant defines its own, very specific API. The class gathering different
   variants called `WalletBuilder` and its `Runtime` offer facilities to dispatch to either specific variant (e.g. when
   initializing wallet) as well as `current` one.
3. To manage implementations of services and capabilities through builder pattern. Mostly because of TypeScript's
   limitations (lack of higher-kinded types) Effect's services can't work with uninstantiated generic types.
4. To expose idiomatic rx.js- and Promise-based APIs, but expect integration through Effect APIs. Although it needs to
   be revisited, it is current status quo, and seems to be a good compromise, especially in the presence of
   [0009 Use Effect decision](./0009-use-effect.md).

### Positive Consequences

- Wallet SDK Codebase contains only TypeScript code, making it simpler to onboard new developers
- Domain wallet code from Scala ports really well
- Overall type-safety of the solution is at a really good level
- Using public APIs, it is possible to assemble a wallet operating with proof-erased transactions while maintaining the
  same code for transacting and state management
- Using public APIs, it is possible to override almost arbitrary aspect of wallet functionality through the usage of the
  builder pattern
- Facade API for the shielded wallet is really close to existing API
- Integrating purely functional updates (implemented by capabilities) on top of Effect's `SubscriptionRef` is trivial
  and idiomatic, while still allows for side-effecting operations if absolutely needed
- `WalletBuilder` and `Runtime` implementations are very generic and not tied to any specific functionalities other than
  the ability to gather variants and switch between them

### Negative Consequences

- Some of Wallet SDK code already is needed in Rust, which leads to some duplications
- Type machinery enabling the `Runtime` and `WalletBuilder` is relatively complex and relies on a lot of TypeScript's
  inferences
- Very generic and abstract code of the `Runtime` and `WalletBuilder` might be hard to approach at first
- There are overall multiple layers of abstractions introduced, which only start to make sense once everything is
  assembled

## Pros and Cons of the other Options

### Singular API to implement by all variants

An example of the idea:

```ts
// WalletAPI.ts
export interface WalletAPI {
  makeTransfer(params: { amount: bigint; recipient: string }): Promise<Transaction>;
}
// Variant1.ts
export class Variant1 implements WalletAPI {
  makeTransfer(params: { amount: bigint; recipient: string }): Promise<Transaction> {
    /* */
  }
}

// Variant2.ts
export class Variant2 implements WalletAPI {
  makeTransfer(params: { amount: bigint; recipient: string }): Promise<Transaction> {
    /**/
  }
}

// Wallet.ts
export const Wallet = new WalletBuilder<WalletAPI>().addVariant(Variant1).addVariant(Variant2);
```

- Good, because it is the reason of having interfaces
- Bad, because the API could not be type-safe
- Bad, because accomodating future variants would force past ones to be changed

### Gather all implementations through Effect's services, not separating capabilities and services

An example usage could look like this:

```ts
Wallet.makeTransfer({ amount: 42n, to: 'mn_shield-addr1foobar' }).pipe(
  Effect.provideLayer(TransactingService.layer()),
  Effect.provideLayer(WalletStateService.layer()),
);
```

- Good, because it is the idiomatic way of providing dependencies with Effect
- Bad, because it does not promote separating state, operations and side-effects
- Bad, because it does not allow to implement a flavour of wallet operating on proof-erased transactions

### Expect idiomatic, rx.js- and Promise-based API at integration points, expose such as well

For example:

```ts
interface SyncService<S, U> {
  sync(initialState: S): rx.Observable<U>;
}

interface WalletBuilder {
  withSync<U>(service: SyncService<State, U>): WalletBuilder;
  build(): Wallet;
}

interface Wallet {
  state$: rx.Observable<State>;
  makeTransfer(params: { amount: bigint; recipient: string }): Promise<Transaction>;
}
```

- Good, because it hides Effect's complexity from users
- Good, because it makes it easier for the users to provide their implementation
- Bad, because it works particularly bad with the Effect's resource management

### Expose and expect Effect-based APIs

For example:

```ts
interface SyncService<S, U> {
  sync(initialState: S): Stream.Stream<U, WalletError>;
}

interface WalletBuilder {
  withSync<U>(service: SyncService<State, U>): WalletBuilder;
  build(): Wallet;
}

interface Wallet {
  state$: Stream.Stream<State, WalletError>;
  makeTransfer(params: { amount: bigint; recipient: string }): Effect.Effect<Transaction>;
}
```

- Good, because it is the most coherent approach
- Good, because it allows fully leveraging Effect's strengths
- Bad, because it might be too unfamiliar for the users - Effect is quite popular, but not ubiquitous, and it introduces
  some idioms common to e.g. Scala, but somewhat foreign to idiomatic TypeScript
