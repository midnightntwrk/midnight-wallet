# Midnight Wallet

This is an implementation of the [Wallet API](https://github.com/midnightntwrk/midnight-wallet-api),
used by dapp developers and [Midnight.js](https://github.com/midnightntwrk/midnight-js) to:

- Build transactions
- Submit transactions to a [node](https://github.com/midnightntwrk/midnight-substrate-prototype)
- Sync state with an [indexer](https://github.com/midnightntwrk/midnight-indexer)

## Modules structure

This project is a yarn workspaces combined with Turborepo, with Scala pieces managed by [sbt](https://www.scala-sbt.org), meaning that their modules and
dependencies are configured in the [`build.sbt`](build.sbt) file. In many of them `package.json` files can be found and they are registered as workspaces in yarn, so yarn can resolve the dependencies, and [ScalablyTyped](https://scalablytyped.org) can provide Scala type definitions for them. The modules are:

- `wallet-core` - Implementation of the main business logic. This exposes interfaces of services that are
  required to be instantiated, and that can be independently developed and reused

- `wallet-engine` - Dependency injection and instantiation of the main `Wallet` class from `wallet-core`.
  Translation layer to JavaScript types

- `blockchain` - Blockchain model used by the wallet

- `js-interop` - [Facade types](https://www.scala-js.org/doc/interoperability/facade-types.html) and
  general utilities to work with JavaScript libraries such as [rxjs](rxjs.dev/)

- `prover-client` - Implementation of proving server client

- `substrate-client` - Implementation of substrate node client

- `pubsub-indexer-client` - Implementation of PubSub Indexer client

- `bloc` - Basic Scala implementation of the BLoC (Business Logic Component) pattern

- `wallet-zswap` - A module that exposes ZSwap functionalities that is compatible
  with Scala JS and JVM. This is achieved by using a WASM ledger package on JS
  and JNR interfaces on JVM. The module hides the complexity of different
  platforms and enables Scala clients work with idiomatic Scala.
- `integration-tests` - All tests that require an external service to work

## Development setup

### Tools

The tools with the corresponding versions used to build the code are listed in the [.tool-versions](.tool-versions) file.

You can use [asdf](https://asdf-vm.com) and just run `asdf install` to get the correct versions.

Another option is to use [Nix](https://nixos.org). This project provides a [flake](flake.nix) with a devshell definition.

Additionally, it is worth installing turborepo as a global npm package (`npm install -g turbo`), for easier access for turbo command.

Finally, [direnv](https://direnv.net) is optional but strongly recommended.

### Internal private registry and credentials

Follow all authentication steps from the [Authentication setup document](https://input-output.atlassian.net/wiki/spaces/MN/pages/3696001685/Authentication+setup).

## Build

```shell
yarn
turbo dist
```

The generated JavaScript code is written to `wallet-engine/dist`.

## Test

### Unit tests

```shell
turbo test
```

### Integration tests

```shell
sbt integrationTests/test
```

### CI verification

To run the same checks as CI does, run

```shell
turbo verify
```

It runs across all workspaces and sbt modules:
- necessary builds and typechecking
- lints
- unit tests
- integration tests

## Generate test coverage report

```shell
sbt coverage test coverageAggregate
```

An HTML report is written to each module's `target/scala-3.4/scoverage-report/index.html`

## Contributing

All new features must branch off the default branch `main`.

It's recommended to enable automatic scalafmt formatting in your text editor upon save, in order to
avoid CI errors due to incorrect format.

To execute the same verifications that are enabled on the CI, there's an sbt task `verify` which
does the following:

- Compile the code with strict scala compiler flags through the use of
[sbt-tpolecat](https://github.com/DavidGregory084/sbt-tpolecat)
- Check the code with [wartremover](https://www.wartremover.org/)
- Run the unit and integration tests
- Generate coverage reports

To develop quickly, without the linting tools getting in the way, the
environment variable `MIDNIGHT_DEV=true` can be used to make all lint errors be treated as warnings.

## Release a new version

Please read our [git workflow](https://input-output.atlassian.net/wiki/spaces/MN/pages/3378086090/Git+Workflow)
for how to branch and tag releases.

In order to release a new version of the wallet-engine, the version in `wallet-engine/package.json` should be bumped.

After that, use the [Releases](https://github.com/midnightntwrk/midnight-wallet/releases/new) feature
from GitHub to create a tag with a name following the pattern `vX.Y.Z`.
A GitHub action will automatically build and publish the new version.
