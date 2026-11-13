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

## Hard-fork e2e

The hard-fork e2e is a further sub-project, `fork` (`src/tests/*.fork.test.ts`), and the only lane in which a wallet
crosses a real protocol boundary. The `undeployed` and `remote` stacks boot the current node on its own genesis, so
their chain is on ledger-v9 from block 1. This lane instead builds a genesis from the ledger-v8 node's spec, runs it on
the ledger-v9 node binary alongside an indexer and a proof server, syncs a facade wallet on ledger-v8, enacts the ledger
8 → 9 upgrade through the node toolkit's governance `runtime-upgrade`, and then asserts that the wallet crosses, settles
on the new protocol version with its balances intact, and restores from its V2 snapshot. Its compose file is
`infra/compose/docker-compose-fork-dynamic.yml`.

It then spends what it carried. The chain-side dust replay covers cNIGHT holders only, so a wallet holding native NIGHT
arrives on the far side with no dust and has to re-register its Night for dust generation before it can pay a fee at
all; the test does that, then sends both an unshielded and a shielded transfer to a second wallet started on the same
forked chain. The shielded one is the sharp end: those coins crossed the boundary as bytes in a translated local state,
and the spend only succeeds if their Merkle paths still resolve against the ledger-v9 tree.

To run it locally (from the repository root):

```shell
yarn dist
NETWORK=undeployed yarn turbo test-fork
```

Expect roughly eight minutes of wall-clock: spec build and node boot, indexer catch-up, the ledger-v8 sync, governance
plus finality, and the crossing itself. Note that the node toolkit image is pulled from Docker Hub
(`midnightntwrk/midnight-node-toolkit`) rather than ghcr, which has no matching tag — an anonymous pull, so it is
subject to Docker Hub's rate limits. The node, indexer and proof server images come from ghcr as usual.

Every image tag is an environment variable with a default, so a run can be pointed at a different pairing without
editing the compose file:

| Variable             | Default      | Image                                                |
| -------------------- | ------------ | ---------------------------------------------------- |
| `FORK_FROM_NODE_TAG` | `1.0.1`      | node whose spec the chain starts from (ledger-v8)    |
| `NODE_TAG`           | `2.1.101`    | node binary the chain runs on, and upgrades into     |
| `TOOLKIT_TAG`        | `2.1.101`    | `midnight-node-toolkit`, submits the runtime upgrade |
| `INDEXER_TAG`        | `4.4.101`    | `indexer-standalone`                                 |
| `PROOF_SERVER_TAG`   | `9.0.2-rc.1` | `proof-server`                                       |

```shell
NETWORK=undeployed NODE_TAG=2.1.0-rc.1 yarn turbo test-fork
```

Container logs are streamed to `packages/e2e-tests/reports/fork-logs/<service>.log` while the stack runs, and the junit
report lands at `packages/e2e-tests/reports/test-report.xml` as for the other projects. The logs are written from the
fixture rather than collected afterwards because testcontainers tears the compose project down as soon as the suite
ends, leaving nothing for a `docker compose logs` to read.

In CI the lane has its own workflow, `.github/workflows/e2e-hard-fork.yml`: nightly at 02:00 UTC, on demand via
`workflow_dispatch` (which exposes the five image tags as inputs), and on pull requests that touch the lane's own files.
It is deliberately not part of the required `Tests` gate — see the comment at the top of that workflow.

## Tests Guide

Tests are split between `undeployed` and `remote`. Undeployed tests run on a locally built Midnight network with
prefunded wallet funds. The docker file for running local instance of Midnight network can be found in
`infra/compose/docker-compose-dynamic.yml`.

Remote tests are designed to be run on deployed test environments where test wallets need to be set up with funds and
generated dust to run successfully. All remote tests spin up a local instance of the proof server which can be found in
`infra/compose/docker-compose-remote-dynamic.yml`.

### Funding remote test wallets

The remote suites run on wallets that must already hold funds on the target network:

| Suite                                 | Wallet                | Needs                                                                               |
| ------------------------------------- | --------------------- | ----------------------------------------------------------------------------------- |
| `dust.remote`, `tokenTransfer.remote` | `SEED` (and `SEED2`)  | Night UTxOs, two of them registered and two unregistered, shielded tNight, and Dust |
| `nativeTokenTransfer.remote`          | `NT_SEED`, `NT_SEED2` | shielded tNight and native tokens `…01` and `…02`, and Dust to pay fees             |
| `balanceConstant.remote`              | `SEED_STABLE`         | exactly 1000 shielded tNight, 1000 unshielded tNight, 25 `…01` and 50 `…02`         |

`fundTestWallets.remote.test.ts` tops a wallet up to what these suites need. It only sends what is missing, so it is
safe to run again. It spends real funds, so no other run selects it: run it with

```shell
yarn turbo test-fund
```

In the funding script the seed variables mean something different from the suites:

- `SEED` is the wallet the funds come from (a faucet wallet).
- `SEED2` is the test wallet to fund. Point it at whichever wallet a suite runs on — the suites' `SEED`, `NT_SEED`,
  `NT_SEED2`, ... — and run the script once per wallet. `FUND_RANDOM_TARGET=true` funds a newly generated wallet instead
  and prints its seed to the console (never to the log files); `false` or unset funds `SEED2`, and any other value is
  refused.
- `SEED_STABLE`, when set, is topped up to the exact balances `balanceConstant` asserts. Each balance below its target
  is topped up; if any is already above, the run then fails naming it, because funding cannot drain it.
- The three seeds must differ; the script refuses to start otherwise.

Set them in the root `.env`: it is loaded with `override: true`, so values given on the command line are replaced by the
`.env` ones. Running from a checkout without a `.env` lets exported variables through instead.

Each test wallet is brought to:

- at least five Night UTxOs of 1000 tNight or more, one of them 10,000 tNight (ten times the usual 1000 tNight); smaller
  UTxOs left from earlier funding amounts do not count;
- at least 1000 shielded tNight, 25 of native token `…01` and 50 of `…02`;
- the 10,000 tNight UTxO and at least one other registered for Dust generation, two other UTxOs left unregistered, and
  enough Dust to pay fees. The generator is registered whenever it is not, together with as many 1000 tNight UTxOs as it
  takes to reach two registered. A new wallet pays that registration's fee from the Dust generated by a single one of
  those UTxOs, the one that has generated most, which is why the generator is ten times the base amount. When the first
  attempt falls short it waits for the rest — longer the smaller the generator.

Dust generation is keyed on a wallet's Night address, while each UTxO carries its own flag. Night sent to a registered
address arrives registered. A deregistration, which the dust deregistration healthcheck makes on every run, removes the
address's registration but leaves the flag on the UTxOs it did not spend, so Night sent afterwards arrives unregistered.
The script therefore never assumes how sent Night will arrive: it reads the flags once the funds are there, registers
what is missing, and fails, naming the remedy, when a registered address leaves it short of unregistered UTxOs.

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
