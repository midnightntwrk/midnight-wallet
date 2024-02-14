**[@midnight-ntwrk/dapp-connector-api v1.1.0](https://github.com/input-output-hk/midnight-wallet/typescript/dapp-connector-api)** • [Readme](../README.md) \| [API](../globals.md)

***

[@midnight-ntwrk/dapp-connector-api v1.1.0](../README.md) / DAppConnectorWalletAPI

# Interface: DAppConnectorWalletAPI

Shape of the Wallet API in the DApp Connector

## Properties

### balanceAndProveTransaction

> **balanceAndProveTransaction**: (`tx`, `newCoins`) => `Promise`\<`Transaction`\>

It will try to balance given transaction and prove it

#### Parameters

• **tx**: `Transaction`

Transaction to balance

• **newCoins**: `CoinInfo`[]

New coins created by transaction, for which wallet will watch for

#### Returns

`Promise`\<`Transaction`\>

Proved transaction or error

***

### balanceTransaction

> **balanceTransaction**: (`tx`, `newCoins`) => `Promise`\<`BalanceTransactionToProve` \| `NothingToProve`\>

#### Parameters

• **tx**: `Transaction`

• **newCoins**: `CoinInfo`[]

#### Returns

`Promise`\<`BalanceTransactionToProve` \| `NothingToProve`\>

#### Deprecated

Since version 1.1 and will be deleted in version 2.0.0. Please use `balanceAndProveTransaction` method instead.

***

### proveTransaction

> **proveTransaction**: (`recipe`) => `Promise`\<`Transaction`\>

#### Parameters

• **recipe**: `ProvingRecipe`

#### Returns

`Promise`\<`Transaction`\>

#### Deprecated

Since version 1.1.0 and will be deleted in version 2.0.0. Please use `balanceAndProveTransaction` method instead.

***

### state

> **state**: () => `Promise`\<[`DAppConnectorWalletState`](DAppConnectorWalletState.md)\>

Returns a promise with the exposed wallet state

#### Returns

`Promise`\<[`DAppConnectorWalletState`](DAppConnectorWalletState.md)\>

***

### submitTransaction

> **submitTransaction**: (`tx`) => `Promise`\<`string`\>

It will submit given transaction to the node

#### Parameters

• **tx**: `Transaction`

Transaction to submit

#### Returns

`Promise`\<`string`\>

First transaction identifier from identifiers list or error
