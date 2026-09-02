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
yarn test-e2e src/tests/emptyWallet.universal.test.ts
```

## Hard-fork drill

The hard-fork drill is a further e2e sub-project, `fork` (`src/tests/*.fork.test.ts`), and the only lane in which a
wallet crosses a real protocol boundary. The `undeployed` and `remote` stacks boot the current node on its own genesis,
so their chain is post-fork from block 1. The drill instead builds a genesis from the _old_ node's spec (ledger 8), runs
it on the _new_ node binary alongside an indexer and a proof server, syncs a facade wallet pre-fork, enacts the ledger 8
→ 9 upgrade through the node toolkit's governance `runtime-upgrade`, and then asserts that the wallet crosses, settles
on the new protocol version with its balances intact, and restores from its post-fork snapshot. Its compose file is
`infra/compose/docker-compose-fork-dynamic.yml`.

It then spends what it carried. The chain-side dust replay covers cNIGHT holders only, so a wallet holding native NIGHT
arrives on the far side with no dust and has to re-register its Night for dust generation before it can pay a fee at
all; the drill does that, then sends both an unshielded and a shielded transfer to a second wallet started on the same
forked chain. The shielded one is the sharp end: those coins crossed the boundary as bytes in a translated local state,
and the spend only succeeds if their Merkle paths still resolve against the post-fork tree.

To run it locally (from the repository root):

```shell
yarn dist
NETWORK=undeployed yarn turbo test-fork
```

Expect roughly eight minutes of wall-clock: spec build and node boot, indexer catch-up, the pre-fork sync, governance
plus finality, and the crossing itself. Note that the node toolkit image is pulled from Docker Hub
(`midnightntwrk/midnight-node-toolkit`) rather than ghcr, which has no matching tag — an anonymous pull, so it is
subject to Docker Hub's rate limits. The node, indexer and proof server images come from ghcr as usual.

Every image tag is an environment variable with a default, so a run can be pointed at a different pairing without
editing the compose file:

| Variable             | Default               | Image                                                |
| -------------------- | --------------------- | ---------------------------------------------------- |
| `FORK_FROM_NODE_TAG` | `1.0.1`               | node whose spec the chain starts from (pre-fork)     |
| `NODE_TAG`           | `2.1.0-beta.1`        | node binary the chain runs on, and upgrades into     |
| `TOOLKIT_TAG`        | `2.1.0-beta.1`        | `midnight-node-toolkit`, submits the runtime upgrade |
| `INDEXER_TAG`        | `4.4.0-rc.2-25da0487` | `indexer-standalone`                                 |
| `PROOF_SERVER_TAG`   | `9.0.0-rc.7`          | `proof-server`                                       |

```shell
NETWORK=undeployed NODE_TAG=2.1.0-rc.1 yarn turbo test-fork
```

Container logs are streamed to `packages/e2e-tests/reports/fork-logs/<service>.log` while the stack runs, and the junit
report lands at `packages/e2e-tests/reports/test-report.xml` as for the other projects. The logs are written from the
fixture rather than collected afterwards because testcontainers tears the compose project down as soon as the suite
ends, leaving nothing for a `docker compose logs` to read.

In CI the drill has its own workflow, `.github/workflows/e2e-fork-drill.yml`: nightly at 02:00 UTC, on demand via
`workflow_dispatch` (which exposes the five image tags as inputs), and on pull requests that touch the lane's own files.
It is deliberately not part of the required `Tests` gate — see the comment at the top of that workflow.

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
