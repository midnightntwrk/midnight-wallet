# Midnight Wallet E2E Tests in TypeScript

This directory contains e2e wallet tests written using Jest that run against a local docker compose environment or a hosted deployment of choice.

## Setup

### 1. Nix

First install [Nix](https://nixos.org). Then [direnv](https://direnv.net) is optional but strongly recommended.
This project provides a [flake](flake.nix) with a dev shell definition.

### 2. Internal private registry and credentials

Configure Yarn and Nix by following the [Authentication setup document](https://input-output.atlassian.net/wiki/spaces/MN/pages/3696001685/Authentication+setup).

### 3. Install npm dependencies

```shell
nix develop .#typescript --command yarn
```

from the root of the project

## Running e2e tests

Tests require following environment variables set to define which networkId to use and against which deployment you want to run them. Based on these, an appropriate docker compose file will be spun up using testcontainers.

- for local:

```
export DEPLOYMENT=local; export NETWORK=undeployed
```

- for devnet deployments:

  ```
  export DEPLOYMENT=ariadne-qa; export NETWORK=devnet
  ```

  ```
  export DEPLOYMENT=devnet; export NETWORK=devnet
  ```

  - additional environment variables are needed to supply seeds of the test wallets on devnet networks: `SEED` and `SEED2`

Then to run all tests (all following commands in the root of the project):

```shell
nix develop .#typescript --command yarn test-e2e
```

To run a subset of tests with a tag:

```shell
nix develop .#typescript --command yarn test-e2e -- -t @healthcheck
```

To run tests from a specific file:

```shell
nix develop .#typescript --command yarn test-e2e -- packages/e2e-tests/src/tests/emptyWallet.test.ts
```
