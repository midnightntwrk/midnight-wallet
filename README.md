# Midnight Wallet
[![CI](https://github.com/input-output-hk/midnight-wallet/actions/workflows/ci.yml/badge.svg?event=push)](https://github.com/input-output-hk/midnight-wallet/actions/workflows/ci.yml)


This is an implementation of the [Wallet API](https://github.com/input-output-hk/midnight-wallet-api),
used by dapp developers and [client SDK](https://github.com/input-output-hk/midnight-client-sdk) to:

- Build transactions
- Submit transactions to a node
- Obtain transactions from a node

The current reference node implementation, which this wallet is able to connect, is 
the [Mocked Node](https://github.com/input-output-hk/midnight-mocked-node).

## Modules structure

This is an [sbt](https://www.scala-sbt.org) project, meaning that the modules and 
dependencies are configured in the [`build.sbt`](build.sbt) file. The modules are:

- `wallet-core` - Implementation of the main business logic. This exposes interfaces of services that are
  required to be instantiated, and that can be independently developed and reused

- `wallet-engine` - Dependency injection and instantiation of the main `Wallet` class from `wallet-core`.
  Translation layer to JavaScript types

- `blockchain` - Blockchain model used by the wallet

- `ogmios-sync` - Implementation of the `SyncService` from `wallet-core` module using the Ouroboros mini protocols

- `ogmios-tx-submission` - Implementation of the `TxSubmissionService` from `wallet-core` module using the Ouroboros mini protocols

- `js-interop` - [Facade types](https://www.scala-js.org/doc/interoperability/facade-types.html) and
  general utilities to work with JavaScript libraries such as [rxjs](rxjs.dev/)

`wallet-engine` and `ogmios-sync` use [yarn](https://classic.yarnpkg.com) under the hood to fetch
npm dependencies via [ScalablyTyped](https://scalablytyped.org), so you will find `package.json`, 
`yarn.lock`, and `.npmrc` configuration files inside those submodules.

There is also an `examples` directory that shows how to set up a TypeScript client to use the wallet.

## Development setup

### 1. Nix

To start developing, first install [Nix](https://nixos.org). Then [direnv](https://direnv.net) is 
optional but strongly recommended.
This project provides a [flake](flake.nix) with a dev shell definition.

### 2. Internal private registry and credentials

Follow all authentication steps from the [Authentication setup document](https://input-output.atlassian.net/wiki/spaces/MN/pages/3696001685/Authentication+setup).

### 3. Developing

After installing Nix and configuring the credentials you are all set up to start developing.

If you're using direnv, only the first time you will need to do:
```shell
direnv allow
```
After that `sbt` and `yarn` should be available in your path. 

If you're not using direnv, you will have to manually start the dev shell every time with:

```nix
nix develop
```

## Build

```shell
sbt dist
```

The generated JavaScript code is written to `wallet-engine/dist` and `ogmios-sync/js/dist`.

## Test

### Unit tests

```shell
sbt test
```

### Integration tests

```shell
sbt IntegrationTest/test
```

```shell
cd examples
yarn install # If needed
yarn lint && yarn test
```

## Generate test coverage report

```shell
sbt coverage test coverageAggregate
```

An HTML report is written to each module's `target/scala-2.13/scoverage-report/index.html`

## Contributing

All new features must branch off the default branch `main`.

It's recommended to enable automatic scalafmt formatting in your text editor upon save, in order to 
avoid CI errors due to incorrect format.

To execute the same verifications that are enabled on the CI, there's an sbt task `verify` which 
does the following:

- Compile the code with strict scala compiler flags through the use of 
[sbt-tpolecat](https://github.com/DavidGregory084/sbt-tpolecat)
- Check the code with [wartremover](https://www.wartremover.org/)
- Run the unit and integration tests to verify that the minimum code coverage is reached
- Generate coverage reports

To develop quickly, without the linting tools getting in the way, the
environment variable `MIDNIGHT_DEV=true` can be used to make all lint errors be treated as warnings.

## Release a new version

Please read our [git workflow](https://input-output.atlassian.net/wiki/spaces/MN/pages/3378086090/Git+Workflow)
for how to branch and tag releases.

In order to release a new version, the versions inside `wallet-engine/package.json`,
`wallet-core/package.json`, `ogmios-sync/js/package.json`, and `commonPublishSettings` in
`build.sbt` should be bumped.

After that, use the [Releases](https://github.com/input-output-hk/midnight-wallet/releases/new) feature 
from GitHub to create a tag with a name following the pattern `vX.Y.Z`.
Cicero will detect it and automatically build and publish the new version.

## Maintenance

The nix build captures or "vendors" the scala dependencies, and represents
these dependencies through a hash. This hash will need to be updated when
changing sbt dependencies. Fortunately there's a script to make this easy:

`./update-nix.sh`

to verify the hash is correct

`./update-nix.sh --check`

Notes:
- The hash represents the content of the vendored libraries, and
  if a previous vendored directory exists, nix will not check
  if the directory is the "latest". To avoid this situation,
  please use `./update-nix.sh --check`
- The environment flag `MIDNIGHT_DEV` (`export MIDNIGHT_DEV=true`) could be used to disable compilation and linter checks to speed up development cycle.
  It SHOULD NOT be used on CI server.
