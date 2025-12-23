# Midnight Wallet E2E Tests in TypeScript

This directory contains e2e wallet tests written using Vitest that run against a local docker compose environment or a
hosted deployment of choice.

## Setup

### Yarn

To install the required dependencies in the root of the repository run `yarn install` followed by `yarn dist`

## Running e2e tests

### Environment Setup

Tests require environment variables to be configured. The repository includes a `.env.example` file that serves as a
template showing all available configuration options. To configure your environment:

1. Copy `.env.example` to `.env`:

   ```shell
   cp .env.example .env
   ```

2. Edit `.env` and fill in the required values for your environment (see `.env.example` for descriptions of each
   variable).

The `.env` file is automatically loaded by the test setup when running any tests (including e2e tests). Environment
variables from the `.env` file will override any existing environment variables when executing tests.

Then to run all tests (all following commands in the root of the project):

```shell
yarn test-e2e
```

To run a subset of local tests with a tag:

```shell
yarn test-undeployed -- -t @smoke
```

To run tests from a specific file:

```shell
yarn test-e2e -- packages/e2e-tests/src/tests/emptyWallet.universal.test.ts
```

## Tests Guide

Tests are split between `undeployed` and `remote`. Undeployed tests run on a locally built Midnight network with
prefunded wallet funds. The docker file for running local instance of Midnight network can be found in
`infra/compose/docker-compose-dynamic.yml`.

Remote tests are designed to be run on deployed test environments where test wallets need to be set up with funds and
generated dust to run successfully. All remote tests spin up a local instance of the proof server which can be found in
`infra/compose/docker-compose-remote-dynamic.yml`.

### Tests overview

Balancing - Transaction balancing feature. Ensuring that the lowest available coin should always be spent before
spending higher value coins of the same type.

Balance constant (Remote) - Unused wallet should list the correct amount of shielded and unshielded tokens.

Dust - Dust registration and deregistration transactions. Includes edge cases for spending all available tokens in the
wallet. Dust generation and decay is highly accelerated in `undeployed` so the full available dust generation and decay
can be observed instantly.

Funded wallet - Tokens are correctly listed for prefunded wallet.

Empty wallet - Tests to ensure empty wallet behaves as expected. Includes serialization and restore of wallet facade.
Includes empty wallet state functions e.g. wallet state address.

Multiple wallets - Multiple wallets are able to sync concurrently.

Smoke - Subset of tests that cover core wallet functionality. - Transfer of shielded and unshielded tokens - Wallets
serialization and restore

Token transfer - Wallet transactions for unshielded and shielded tokens. Includes negative scenarios to assert correct
error messages are returned from the wallet.

Native token (remote) - Wallet transactions specifically focused on native shielded tokens.
