# midnight-wallet
Midnight's wallet core development. It is an implementation of wallet internals and allows preparing transactions, submitting them to a node and syncing blocks from the node.

## Technologies involved

The code is written in Scala 3 (using `scala.js`) and there is an API interface in typescript.

**Requirements:**
- sbt `1.6.1` ([download sbt](https://www.scala-sbt.org/download.html))

- node `v16.13.2` (`lts/gallium`) 
  - The node version can be managed with [nvm](https://github.com/nvm-sh/nvm) or [ASDF](https://github.com/asdf-vm/asdf/).
  - with nvm, running `nvm use` should be enough since there is a `.nvmrc` file
- yarn `3.1.1`

## Dependencies of the project

- [midnight-platform](https://github.com/input-output-hk/midnight-platform): the midnight node and consensus
- [Racket Server](https://github.com/input-output-hk/lares): implementations of the Kachina approach to smart contracts. It might evolve to multiple components (wallet BE, lares runtime)
- [snarkie](https://github.com/input-output-hk/snarkie): creates/verifies zero-knowledge proofs

### Depends on midnight-wallet
- [midnight-client-sdk](https://github.com/input-output-hk/midnight-client-sdk): an SDK for Midnight Platform client-side code (DApps, UI)


`midnight-wallet`:
   - implements an interface used by the `midnight-client-sdk`, which interacts with both the DApps and UI and with the Racket Server (`Lares`)
   - builds transactions as per request of the `midnight-client-sdk` and interacts with `snarky` to obtain zk-proofs if required
   - submits transactions to `midnight-platform`
   - obtains blocks from `midnight-platform` and submits them to the Racket Server (`Lares`)
   - returns semantic events from submitting blocks to the Racket Server (`Lares`) to `midnight-client-sdk`



## Directory structure
- `api` contains the interface required by `midnight-client-sdk`
  - `wallet.ts` defines in typescript the API which is later compiled to scala
- `impl`
  - `api` implementation of the API used by `midnight-client-sdk`
    - `WalletImp.scala` implements the interface complied from typescript to scala.js
  - `clients` implementation of interaction with Midnight Platform and Racket Server (Lares)
  - `domain` domain model of the wallet
  - `services` service layer, currently implements Prover Service (Snarky Server) and Platform Service

## How to build

`yarn install`

`yarn run build`

**Disclaimer and temporary fix:** to be able to properly build the project we need to remove a directory every time there are changes in the interface (`wallet.ts`) since the scala code generated does not get regenerated after changes. The problematic directory is the local ivy repository.

In the root folder of the project run
`rm -rf ~/.ivy2/local/org.scalablytyped`

## How to test

`yarn run test`