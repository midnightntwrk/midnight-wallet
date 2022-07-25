# midnight-wallet
![example event parameter](https://github.com/input-output-hk/midnight-wallet/actions/workflows/ci.yml/badge.svg)

This is an implementation of [wallet-api](https://github.com/input-output-hk/midnight-wallet-api),
used by dapp developers and [client-sdk](https://github.com/input-output-hk/midnight-client-sdk) to:
 
- Build transactions, interacting with [snarkie](https://github.com/input-output-hk/snarkie) to
obtain zk-proofs if necessary
- Submit transactions to a node
- Obtain blocks from a node and submit them to wallet-backend
- Stream semantic events from submitting blocks to wallet-backend

## Requirements

### Using Nix


```nix
nix develop
```

### Manual

If for some reason Nix can't be used to build this project:

1. [Download the latest version of `sbt`](https://www.scala-sbt.org/download.html).
The version used to build the project is defined in the file 
[`project/build.properties`](project/build.properties) and 
it's automatically picked up by any sbt version that is installed.

2. sbt itself depends on Java JDK. Download the corresponding version defined in the file [`flake.nix`](flake.nix).

3. To run the unit tests, install [Node.js](https://nodejs.org/en/). The version is defined in the file
[`flake.nix`](flake.nix), and there's also a file [`.nvmrc`](.nvmrc) so it can be picked up by tools such as `asdf` or `nvm`.

## External services

- [midnight-platform](https://github.com/input-output-hk/midnight-platform): the Midnight node and consensus
- [Racket Server](https://github.com/input-output-hk/lares): implementations of the Kachina approach to smart contracts. It might evolve to multiple components (wallet-backend, lares runtime)
- [snarkie](https://github.com/input-output-hk/snarkie): creates/verifies zero-knowledge proofs

## Directory structure
`build.sbt` - sbt project definition, Scala version, dependencies, build configuration

`project`
- `build.properties` - defines sbt version
- `plugins.sbt` - sbt plugins

`wallet-core/src/main/scala/io/iohk/midnight/wallet`
  - `clients` - Implementation of interaction with external services
  - `js` - Interoperability with Javascript
  - `services` - Service layer that depends on clients and exposes only domain types
  - `util` - Utilities that can be used by many layers and aren't domain specific
  - `Wallet.scala` - Implementation of the main business logic
  - `WalletBuilder.scala` - Dependency injection and instantiation of the `Wallet` class

`blockchain/src/main/scala/io/iohk/midnight/wallet`
  - `blockchain` - Domain model of the wallet
    - `services` - Interfaces of services that wallet core uses, that can be independently developed and reused

`ogmios-sync/src/main/scala/io/iohk/midnight/wallet/ogmios`
  - `sync` - Implementation of the `SyncService` from `blockchain` module using the Ogmios protocol
 
`[wallet-core|wallet-engine|blockchain|ogmios-sync|ogmios-tx-submission]/src/test` - Same projet structure as `main` sources. `Spec` suffix is added to test corresponding
classes and `Stub` suffix is added to create stubs that can be used by other unit tests

`integration-tests` - A subproject specifically for developing integration tests 


## Credentials

To be able to fetch our internal dependencies, it is required to have our nexus credentials. To get them, you have to contact our devops team. Once you have them, you need to set three `env` variables:
```
$ export MIDNIGHT_REPO_USER=your_user

$ export MIDNIGHT_REPO_PASS=your_password
```

From these credentials you can generate an `NPM_TOKEN` that is also required. From your home directory run:

```
npm login --scope=@midnight --registry=https://nexus.p42.at/repository/npm-midnight/
```
You will be required to input the nexus user and password plus the email associated. After that, check that the following file exists and copy the token:

```
$ cat ~/.npmrc
@midnight:registry=https://nexus.p42.at/repository/npm-midnight/
//nexus.p42.at/repository/npm-midnight/:_authToken=NpmToken.YOUR_NPM_TOKEN

```
Use it to set the npm token for the project:
```
$ export NPM_TOKEN=YOUR_NPM_TOKEN
```


We strongly suggest using [direnv](https://direnv.net/) to simplify setting these variables.

## Build

`sbt dist`

The generated JavaScript code is written to `wallet-core/target/dist`.

## Test

#### Unit tests

`sbt walletCore/test blockchainJS/test ogmiosSyncJS/test ogmiosTxSubmissionJS/test walletEngine/test`

#### Integration tests

See the integration-tests [README](integration-tests/README.md) for instructions.

## Generate Coverage report

`sbt coverage walletCore/test blockchainJS/test ogmiosSyncJS/test ogmiosTxSubmissionJS/test walletEngine/test coverageReport`

An HTML report is written to each module's `target/scala-2.13/scoverage-report/index.html`

## Contributing

All new features must branch off the default branch `main`.

It's recommended to enable automatic scalafmt formatting in your text editor upon save, in order to 
avoid CI errors due to incorrect format.

To develop quickly, without the linting tools getting in the way, the 
environment variable `MIDNIGHT_DEV=true` can be used to make all lint errors be treated as warnings.

To execute the same verifications that are enabled on the CI, there's an sbt task `verify` which 
does the following:

- Compile the code with strict scala compiler flags through the use of 
[sbt-tpolecat](https://github.com/DavidGregory084/sbt-tpolecat)
- Check the code with [wartremover](https://www.wartremover.org/)
- Check the code with [scapegoat](https://github.com/scapegoat-scala/sbt-scapegoat)
- Run the unit tests to verify that the minimum code coverage is reached
- Generates coverage reports

## Publish artifact

In order to publish, the version inside `wallet-core/package.json` should be bumped and the change merged into main.

## Build Nix

`nix-build`

## Maintenance

The nix build captures or "vendors" the scala dependencies, and represents
these dependencies through a hash. This hash will need to be updated
when changing sbt dependencies. Fortunately there's a script to make this easy:

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
