---
'@midnightntwrk/wallet-sdk-node-client': minor
'@midnightntwrk/wallet-sdk': minor
---

feat(node-client): add a fake Polkadot node to the testing entry

`FakePolkadotNode` in `@midnightntwrk/wallet-sdk-node-client/testing`, and re-exported from
`@midnightntwrk/wallet-sdk/node-client/testing`, stands in for `@polkadot/api` in unit tests, so a
`PolkadotNodeClient`, or a submission service built on one, submits to a node whose answers a test sets: the statuses
it reports (`submissionResult`), a refusal of the submission call, or calls that fail on a connected socket. Pass
`FakePolkadotNode.shared.module` to `vi.mock('@polkadot/api', …)` and drive the same node from the test. Importing
`/testing` also loads `TestTransactions`, so its optional peer dependencies (`@effect/platform`,
`@midnightntwrk/ledger-v9`, `@midnightntwrk/wallet-sdk-prover-client`, `tar-stream`, `testcontainers`) must be
installed.
