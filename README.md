# Midnight Wallet SDK

Implementation of
[Midnight Wallet Specification](https://github.com/midnightntwrk/midnight-architecture/blob/main/components/WalletEngine/Specification.md).
It provides components for:

- generating keys and addresses
- formatting keys and addresses
- building transactions
- submitting transactions to a [node](https://github.com/midnightntwrk/midnight-node)
- handling swaps
- syncing state with [indexer](https://github.com/midnightntwrk/midnight-indexer)
- testing without external infrastructure

## Examples and documentation

[Docs](./docs) directory features some design documentation and development guidelines.

Example usage can be found at [docs snippets](./packages/docs-snippets/src/snippets) (always up-to-date with the recent
changes) or at the [SDK documentation site](https://docs.midnight.network/sdks/official/wallet-developer-guide) (aligned
with the recent release)

## Modules structure

This project is a Yarn workspaces monorepo combined with Turborepo. Packages are organized under `packages/` and
applications under `apps/`. Main packages are:

- `facade` - unified wallet API combining shielded, unshielded, and dust wallet types into a single interface
- `shielded-wallet` - shielded token operations with zero-knowledge proof support
- `unshielded-wallet` - unshielded token operations on the ledger
- `dust-wallet` - dust management for transaction fees
- `runtime` - wallet builder and lifecycle management, orchestrating wallet variants across migration points (e.g.
  hard-forks)
- `abstractions` - common abstractions and definitions - variants need to implement specific interfaces to be used
  through the wallet builder, but can't depend on the builder itself
- `capabilities` - shared and universal definitions and implementations for capabilities, e.g. transaction balancing and
  coin selection
- `address-format` - implementation of Bech32m formatting for Midnight keys and addresses
- `hd` - implementation of HD-wallet API (BIP32/BIP39) for Midnight
- `utilities` - common operations and types shared across packages
- `indexer-client` - GraphQL client for syncing state with the indexer
- `node-client` - Polkadot RPC client for communicating with the Midnight node
- `prover-client` - client for zero-knowledge proof generation
- `wallet-integration-tests` - tests examining public APIs
- `e2e-tests` - end-to-end integration tests
- `docs-snippets` - documentation code examples

Applications:

- `test-website` - React-based browser testing application for the wallet SDK

> [!NOTE]
>
> Packaging for web requires polyfills for Node's `Buffer` and `assert`.

For a reference about structure and internal rules to follow, consult [Design Doc](./docs//Design.md) and
[IcePanel component diagram](https://app.icepanel.io/landscapes/yERCUolKk91aYF1pzsql/versions/latest/diagrams/editor?diagram=JwWBu6RYGg&model=onccvco5c4p&overlay_tab=tags&x1=-1463.3&y1=-888&x2=2295.3&y2=1072)

## Development setup

### Tools

We use [nvm](https://github.com/nvm-sh/nvm) to manage the node version and the version of yarn is managed by
[.yarnrc.yml](.yarnrc.yml).

To start development from a new machine it is recommended to run the following

```shell
nvm use
corepack enable
```

Another option is to use [Nix](https://nixos.org). This project provides a [flake](flake.nix) with a devshell
definition. In such case [direnv](https://direnv.net) is strongly recommended.

**Environment Variables**: Environment variables can be configured via a `.env` file in the repository root for local
test execution.

We also support loading environment variables via [direnv](https://direnv.net).

See the [Test Environment Setup](#test) section below for setup instructions.

Additionally, it is worth installing turborepo as a global npm package (`npm install -g turbo`), for easier access for
turbo command.

### Internal private registry and credentials

Follow all authentication steps from the
[Authentication setup document](https://input-output.atlassian.net/wiki/spaces/MN/pages/3696001685/Authentication+setup).

## Install dependencies

Install all project dependencies using Yarn.

```shell
yarn
```

## Build

Build the projects once, generated Javascript code is written to the project's `dist` directory.

```shell
yarn dist
```

To build a specific package, use the `--filter` flag:

```shell
yarn dist --filter=@midnight-ntwrk/wallet-sdk-facade
```

## Build and watch

Build the project and watch for changes to automatically rebuild. Generated Javascript code is written to the project's
`dist` directory

```shell
yarn watch
```

## Clean

Clean exiting `dist` directories.

```shell
yarn clean
```

## Format

Formats source code.

```shell
yarn format
```

## Test

### Environment Setup

Tests that require environment variables (such as those using Docker Compose for local infrastructure) need to be
configured. The repository includes a `.env.example` file that serves as a template showing all available configuration
options. To configure your environment:

1. Copy `.env.example` to `.env`:

   ```shell
   cp .env.example .env
   ```

2. Edit `.env` and fill in the required values for your environment (see `.env.example` for descriptions of each
   variable).

The `.env` file is automatically loaded by test setup files for tests that require environment variables (such as those
using Docker Compose).

If you're using [direnv](https://direnv.net), the `.env` file will also be loaded into your shell environment when you
enter the directory, making the variables available to any commands you run in that shell.

### Unit tests

```shell
yarn test
```

To run tests for a specific package:

```shell
yarn test --filter=@midnight-ntwrk/wallet-sdk-unshielded-wallet
```

To run a specific test file:

```shell
yarn test --filter=@midnight-ntwrk/wallet-sdk-unshielded-wallet -- test/UnshieldedWallet.test.ts
```

### CI verification

To run the same checks as CI does, run

```shell
yarn verify
```

It runs across all workspaces:

- necessary builds and typechecking
- lints
- unit tests
- integration tests

## Contributing

All new features must branch off the default branch `main`.

It's recommended to enable automatic formatting in your text editor upon save (via Prettier), in order to avoid CI
errors due to incorrect format.

To execute the same verifications that are enabled on the CI, you should run `yarn verify` as documented above.

## Release a new version

We use [Changesets](https://github.com/changesets/changesets) to manage versioning, changelogs, and publishing. For full
details on the release process, see the [Developer Guide](./DEV_GUIDE.md).

When your PR introduces a releasable change, add a changeset:

```shell
yarn changeset add
```

If the change doesn't need a release (e.g. docs, internal tooling), add an empty changeset:

```shell
yarn changeset add --empty
```

A GitHub Action automatically creates and maintains a `chore: release` PR that applies version bumps and changelog
updates. Merging that PR publishes new versions to the package registry.

### LICENSE

Apache 2.0.

### README.md

Provides a brief description for users and developers who want to understand the purpose, setup, and usage of the
repository.

### SECURITY.md

Provides a brief description of the Midnight Foundation's security policy and how to properly disclose security issues.

### CONTRIBUTING.md

Provides guidelines for how people can contribute to the Midnight project.

### CODEOWNERS

Defines repository ownership rules.

### ISSUE_TEMPLATE

Provides templates for reporting various types of issues, such as: bug report, documentation improvement and feature
request.

### PULL_REQUEST_TEMPLATE

Provides a template for a pull request.

### CLA Assistant

The Midnight Foundation appreciates contributions, and like many other open source projects asks contributors to sign a
contributor License Agreement before accepting contributions. We use CLA assistant
(https://github.com/cla-assistant/cla-assistant) to streamline the CLA signing process, enabling contributors to sign
our CLAs directly within a GitHub pull request.

### Dependabot

The Midnight Foundation uses GitHub Dependabot feature to keep our projects dependencies up-to-date and address
potential security vulnerabilities.

### Unito

Facilitates two-way data synchronization, automated workflows and streamline processes between: Jira, GitHub issues and
Github project Kanban board.
