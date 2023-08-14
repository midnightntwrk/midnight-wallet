# Midnight Wallet Typescript

This directory contains the midnight wallet in server api definition and implementation.

### NOTE: An alternative devshell named "typescript" has to be used in order for the wallet server to work. Please follow the instructions below.

## Modules structure

This is a [turborepo](https://turbo.build/repo) project, the packages live in the [packages](./packages) directory:

- `wallet-server-api` - the definition of the wallet server api and it's request/response data types
- `wallet-client` - the package that's used in dapps to communicate with the wallet server (currently used in the dao-server package)
- `wallet-ui-client` - the package that's used in the wallet to communicate with the wallet server (currently used in the Lace browser extension)
- `wallet-cli` - a command line user interface implementation of the wallet, used as an alternative to the Lace browser extension to view address, balance and sign transactions

and lastly, there's the ` wallet server` implementation under `apps/wallet-server`.

## Development setup

### 1. Nix

To start developing, first install [Nix](https://nixos.org). Then [direnv](https://direnv.net) is
optional but strongly recommended.
This project provides a [flake](flake.nix) with a dev shell definition.

### 2. Internal private registry and credentials

Configure Yarn and Nix by following the [Authentication setup document](https://input-output.atlassian.net/wiki/spaces/MN/pages/3696001685/Authentication+setup).

### 3. Developing

After installing Nix and configuring the credentials you are all set up to start developing.

Start the devshell with:

```nix
nix develop .#typescript
```

---

### Install the dependencies:

```shell
yarn install
```

### Build

```shell
yarn build
```

### Lint

```sh
yarn lint
```

### Tests

The following command runs the tests and generates code coverage report, which is available within `coverage` directory.

```sh
yarn test
```

## How to run the wallet server

```shell
yarn wallet-server -- start --wallet=<walletNumber> --port=<walletPort> --genesis-file-path=<path-to-genesis.json> --confirm-all --cli=<boolean>
```

where:

- `wallet` - key and state from the genesis file
- `port` - the port the instance listens to
- `genesis-file-path` - the path to genesis file (should be in the [midnight example apps repo](https://github.com/input-output-hk/midnight-example-applications))
- `confirm-all` - flag to automatically confirm all requests, useful in this context because turborepo can't forward stdin (only relevant when `--cli=true`)
- `cli` - This allows you to choose between using cli and dapp connector (in [Lace Browser Extension](https://github.com/input-output-hk/lace-private/tree/midnight)) to sign transactions. Default value is `false`.

Additional details regarding configuration or commands available can be learned by running

```shell
yarn wallet-server -- help
```

## Contributing

All new features must branch off the default branch `main`.

It's recommended to enable automatic `eslint` formatting in your text editor
upon save, in order to avoid CI errors due to incorrect format.
