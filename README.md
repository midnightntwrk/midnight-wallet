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

## Modules structure

This project is a yarn workspaces combined with Turborepo. In many of them `package.json` files can be found and they
are registered as workspaces in yarn, so yarn can resolve the dependencies. Main packages/sub-projects are:

- `wallet/v1` - the shielded wallet variant
- `wallet` - wallet runtime and builder - allows orchestrating variants of a wallet across migration points (most
  importantly - hard-forks)
- `abstractions` - common abstractions and definitions - variants need to implement specific interfaces to be used
  through wallet builder, but can't depend on the builder itself
- `address-format` - implementation of Bech32m formatting for Midnight keys and addresses
- `hd` - implementation of HD-wallet API for Midnight
- `capabilities` - shared and universal definitions and implementations for capabilities. E.g. balancing or coin
  selection
- `wallet-integration-tests` - tests examining public APIs

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
turbo dist
```

## Build and watch

Build the project and watch for changes to automatically rebuild. Generated Javascript code is written to the project's
`dist` directory

```shell
turbo watch dist
```

## Clean

Clean exiting `dist` directories.

```shell
turbo clean
```

## Format

Formats source code.

```shell
turbo format
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
turbo test
```

### Integration tests

```shell
sbt integrationTests/test
```

### CI verification

To run the same checks as CI does, run

```shell
turbo verify
```

It runs across all workspaces:

- necessary builds and typechecking
- lints
- unit tests
- integration tests

## Contributing

All new features must branch off the default branch `main`.

It's recommended to enable automatic scalafmt formatting in your text editor upon save, in order to avoid CI errors due
to incorrect format.

To execute the same verifications that are enabled on the CI, you should run `CI Verifications` as documented above.

## Release a new version

Please read our [git workflow](https://input-output.atlassian.net/wiki/spaces/MN/pages/3378086090/Git+Workflow) for how
to branch and tag releases.

After that, use the [Releases](https://github.com/midnightntwrk/midnight-wallet/releases/new) feature from GitHub to
create a tag with a name following the pattern `vX.Y.Z`. A GitHub action will automatically build and publish the new
version.

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

### Checkmarx

The Midnight Foundation uses Checkmarx for application security (AppSec) to identify and fix security vulnerabilities.
All repositories are scanned with Checkmarx's suite of tools including: Static Application Security Testing (SAST),
Infrastructure as Code (IaC), Software Composition Analysis (SCA), API Security, Container Security and Supply Chain
Scans (SCS).

### Unito

Facilitates two-way data synchronization, automated workflows and streamline processes between: Jira, GitHub issues and
Github project Kanban board.
