# Descaling Wallet

- Status: accepted
- Deciders: Andrzej Kopeć, Agron Murtezi
- Date: November 2024

Technical Story: related (but not exactly this) https://input-output.atlassian.net/browse/PM-9789

## Context and Problem Statement

With the team betting on Rust and TS as primary technologies Midnight is built with, there is less and less of Scala
code and Scala developers around. This renders initial approach (write as much application-level code in Scala as
possible, leaving to Rust and TS only what is somewhat necessary) no longer sustainable, posing serious risks related to
Wallet SDK development. Ultimately this led to a decision of removing Scala from Wallet SDK codebase (and in most part -
replacing it with TypeScript), but a remaining question is - how to perform this operation.

## Decision Drivers

- maintaining Wallet SDK functional without conversion being finished
- possibility of continuing feature development during the conversion
- possibility to pause the conversion in case of priority change
- possibility to introduce a new, modular set of Wallet SDK APIs

## Considered Options

- "Big-Bang" style of rewrite, with the team focusing solely on the rewrite
- "Strangler fig" pattern (https://martinfowler.com/bliki/StranglerFigApplication.html) executed in small, atomic steps,
  by limited number of people

## Decision Outcome

Chosen option: "Strangler fig", because it ticks all the boxes, allows the team to make progress with implementing new
functionality during the process. The details of the process are outlined below:

1. Restructure the Wallet SDK repository to be driven by TS tooling, using yarn workspaces and turborepo (or maybe
   pnpm?). sbt would be called by package.json scripts
2. Replace existing wallet package with a proxy one, defined in TypeScript. The Scala one gets renamed and all its
   exports are re-exported by the new TS package to maintain compatibility.
3. Move all Scala code into a single sbt project to not run into issues with package boundaries when needing to expose
   pieces of e.g. wallet-core as JS objects
4. Remove all instances of effect polymorphism/higher-kinded types, to make possible interoperatibility simpler
5. In the new TS package, introduce a new builder, at this point being a proxy to the existing one, but with an API
   following builder pattern.
6. For each capability/service present in Scala codebase:
   - allow to provide it externally by the new builder
   - expose existing implementation as a default one to provide
   - rewire Scala codebase to accept such instance from outside
7. For each capability/service accepted by the new builder:
   - rewrite/create test suite in TS for it
   - ensure the Scala implementation passes the test suite
   - rewrite the implementation into TS

### Positive Consequences

- Wallet SDK becomes a primarily TypeScript codebase, at some point reaching a clear state, where rewrites become
  isolated and relatively simple
- New APIs constructing wallet instance are introduced along the way
- Very early in the process there is introduced ability to implement new functionalities mostly in TypeScript

## Pros and Cons of the Options

### "Big Bang" rewrite

- Good, because there is less functionality to migrate from Scala to TS
- Bad, because feature development would need to stop to execute it effectively
- Bad, because it is a much more risky approach

### "Strangler fig"

- Good, because it does not disrupt feature development
- Good, because there is no risk of getting out of sync with main branch
- Bad, because codebase will depend on Scala for longer time
