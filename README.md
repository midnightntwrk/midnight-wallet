# midnight-wallet
[![CI](https://github.com/input-output-hk/midnight-wallet/actions/workflows/ci.yml/badge.svg?event=push)](https://github.com/input-output-hk/midnight-wallet/actions/workflows/ci.yml)


This is an implementation of [wallet-api](https://github.com/input-output-hk/midnight-wallet-api),
used by dapp developers and [client-sdk](https://github.com/input-output-hk/midnight-client-sdk) to:

- Build transactions
- Submit transactions to a node
- Obtain blocks from a node

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

- [midnight-mocked-node](https://github.com/input-output-hk/midnight-mocked-node): the Midnight node that we are
  currently using.

## Directory structure
`build.sbt` - sbt project definition, Scala version, dependencies, build configuration

`project`
- `build.properties` - defines sbt version
- `plugins.sbt` - sbt plugins

`wallet-core/src/main/scala/io/iohk/midnight/wallet`
  - `clients` - Implementation of interaction with external services
  - `js` - Interoperability with Javascript
  - `services` - Interfaces of services that wallet core uses, that can be independently developed and reused
  - `util` - Utilities that can be used by many layers and aren't domain specific
  - `Wallet.scala` - Implementation of the main business logic

`wallet-engine/src/main/scala/io/iohk/midnight/wallet/engine`
  - `WalletBuilder.scala` - Dependency injection and instantiation of the `Wallet` class

`blockchain/src/main/scala/io/iohk/midnight/wallet`
  - `blockchain` - Blockchain model used by the wallet

`ogmios-sync/src/main/scala/io/iohk/midnight/wallet/ogmios`
  - `sync` - Implementation of the `SyncService` from `wallet-core` module using the Ogmios protocol

`ogmios-tx-submission/src/main/scala/io/iohk/midnight/wallet/ogmios`
  - `tx_submission` - Implementation of the `TxSubmissionService` from `wallet-core` module using the Ogmios protocol
 
`[wallet-core|wallet-engine|blockchain|ogmios-sync|ogmios-tx-submission]/src/test` - Same projet structure as `main` sources. `Spec` suffix is added to test corresponding
classes and `Stub` suffix is added to create stubs that can be used by other unit tests

## Credentials

To be able to fetch our internal dependencies, it is required to have our Nexus credentials. To get them, you have to contact our devops team. Once you have them, you need to set three `env` variables:
```
$ export MIDNIGHT_REPO_USER=your_user

$ export MIDNIGHT_REPO_PASS=your_password
```

From these credentials you can generate an `NPM_TOKEN` that is also required. From your home directory run:

```
npm login --scope=@midnight --registry=https://nexus.p42.at/repository/npm-midnight/
```
You will be required to input the Nexus user and password plus the email associated. After that, check that the following file exists and copy the token:

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

##### Dependencies - External services
As these tests connect with the real external services, the corresponding services must be running
locally and listening to the configured port to which the tests connect. The tests are intentionally
configured to connect to the default port for the service.

Currently, there is 1 external service being tested:
- Midnight Mocked Node (See [midnight-mocked-node](https://github.com/input-output-hk/midnight-mocked-node/) repo to find out how to run it)

##### How to run

When dependencies are installed and running, from the root project directory run `sbt 'walletEngine/IntegrationTest/test'`
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

In order to publish, the versions both inside `wallet-engine/package.json` and `commonPublishSettings` in `build.sbt` should be bumped and the change merged into main. Then, create a tag on GitHub on top of a 'version bump' commit. The tag itself must follow the versioning pattern: `vX.X.X`.

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
