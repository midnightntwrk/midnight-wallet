# Midnight Wallet SDK

Implementation of [Midnight Wallet Specification](https://github.com/midnightntwrk/midnight-architecture/blob/main/components/WalletEngine/Specification.md). It provides components for:
- generating keys and addresses
- formatting keys and addresses
- building transactions
- submitting transactions to a [node](https://github.com/midnightntwrk/midnight-node)
- handling swaps
- syncing state with [indexer](https://github.com/midnightntwrk/midnight-indexer)
- testing without external infrastructure

## Modules structure

This project is a yarn workspaces combined with Turborepo, with Scala pieces managed by [sbt](https://www.scala-sbt.org), meaning that their modules and
dependencies are configured in the [`build.sbt`](build.sbt) file. In many of them `package.json` files can be found and they are registered as workspaces in yarn, so yarn can resolve the dependencies, and [ScalablyTyped](https://scalablytyped.org) can provide Scala type definitions for them. At this point, there is an ongoing rewrite of Scala code into TypeScript, so that soon whole repository will be uniformly TypeScript. Main packages/sub-projects are:
- `wallet-core` (Scala) - domain definition of a shielded wallet and code surrounding it to enable transacting
- `wallet/v1` (TS) - the rewritten shielded wallet variant, very close in scope to `wallet-core` Scala package 
- `wallet` (TS) - wallet runtime and builder - allows orchestrating variants of a wallet across migration points (most importantly - hard-forks)
- `abstractions` (TS) - common abstractions and definitions - variants need to implement specific interfaces to be used through wallet builder, but can't depend on the builder itself
- `address-format` (TS) - implementation of Bech32m formatting for Midnight keys and addresses
- `hd` (TS) - implementation of HD-wallet API for Midnight
- `capabilities` (TS) - shared and universal definitions and implementations for capabilities. E.g. balancing or coin selection
- `wallet-integration-tests` (TS) - tests examining public APIs

For a reference about structure and internal rules to follow, consult [Design Doc](./docs//Design.md) and [IcePanel component diagram](https://app.icepanel.io/landscapes/yERCUolKk91aYF1pzsql/versions/latest/diagrams/editor?diagram=JwWBu6RYGg&model=onccvco5c4p&overlay_tab=tags&x1=-1463.3&y1=-888&x2=2295.3&y2=1072)

## Development setup

### Tools

The tools with the corresponding versions used to build the code are listed in the [.tool-versions](.tool-versions) file.

You can use [asdf](https://asdf-vm.com) and just run `asdf install` to get the correct versions.

As an alternative - one can use [nvm](https://github.com/nvm-sh/nvm), if only Scala-related tools are provided in a different way.

Another option is to use [Nix](https://nixos.org). This project provides a [flake](flake.nix) with a devshell definition. In such case [direnv](https://direnv.net) is strongly recommended.

Additionally, it is worth installing turborepo as a global npm package (`npm install -g turbo`), for easier access for turbo command.

### Internal private registry and credentials

Follow all authentication steps from the [Authentication setup document](https://input-output.atlassian.net/wiki/spaces/MN/pages/3696001685/Authentication+setup).

## Install dependencies

Install all project dependencies using Yarn.

```shell
yarn
```

## Build

Build the projects once, generated Javascript code is written to the project's `dist` directory.

```shell
turbo dist
```

## Build and watch

Build the project and watch for changes to automatically rebuild. Generated Javascript code is written to the project's `dist` directory

```shell
turbo watch dist
```

## Clean

Clean exiting `dist` directories.

```shell
turbo clean
```

## Format

Formats source code.

```shell
turbo format
```

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
