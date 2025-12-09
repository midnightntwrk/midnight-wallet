# Midnight Wallet E2E Tests in TypeScript

This directory contains e2e wallet tests written using Vitest that run against a local docker compose environment or a
hosted deployment of choice.

## Setup

### 1. Nix

First install [Nix](https://nixos.org). Then [direnv](https://direnv.net) is optional but strongly recommended. This
project provides a [flake](flake.nix) with a dev shell definition.

### 2. Internal private registry and credentials

Configure Yarn and Nix by following the
[Authentication setup document](https://input-output.atlassian.net/wiki/spaces/MN/pages/3696001685/Authentication+setup).

### 3. Install npm dependencies

```shell
nix develop .#typescript --command yarn
```

from the root of the project

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
