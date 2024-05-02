**@midnight-ntwrk/dapp-connector-api v1.1.0** • [Readme](../README.md) \| [API](../globals.md)

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

***

### ~~balanceTransaction~~

> **balanceTransaction**: (`tx`, `newCoins`) => `Promise`\<`BalanceTransactionToProve` \| `NothingToProve`\>

#### Deprecated

Deprecated since version 1.1.0 and will be removed in version 2.0.0. Please use the `balanceAndProveTransaction` method instead.

#### Parameters

• **tx**: `Transaction`

• **newCoins**: `CoinInfo`[]

#### Returns

`Promise`\<`BalanceTransactionToProve` \| `NothingToProve`\>

***

### ~~proveTransaction~~

> **proveTransaction**: (`recipe`) => `Promise`\<`Transaction`\>

#### Deprecated

Deprecated since version 1.1.0 and will be removed in version 2.0.0. Please use the `balanceAndProveTransaction` method instead.

#### Parameters

• **recipe**: `ProvingRecipe`

#### Returns

`Promise`\<`Transaction`\>

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
