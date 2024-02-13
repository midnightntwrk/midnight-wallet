[DApp Connector API Reference - v1.1.0](../README.md) / [Exports](../modules.md) / DAppConnectorWalletAPI

# Interface: DAppConnectorWalletAPI

Shape of the Wallet API in the DApp Connector

## Table of contents

### Properties

- [balanceAndProveTransaction](DAppConnectorWalletAPI.md#balanceandprovetransaction)
- [balanceTransaction](DAppConnectorWalletAPI.md#balancetransaction)
- [proveTransaction](DAppConnectorWalletAPI.md#provetransaction)
- [state](DAppConnectorWalletAPI.md#state)
- [submitTransaction](DAppConnectorWalletAPI.md#submittransaction)

## Properties

### balanceAndProveTransaction

• **balanceAndProveTransaction**: (`tx`: `Transaction`, `newCoins`: `CoinInfo`[]) => `Promise`\<`Transaction`\>

#### Type declaration

▸ (`tx`, `newCoins`): `Promise`\<`Transaction`\>

It will try to balance given transaction and prove it

##### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `tx` | `Transaction` | Transaction to balance |
| `newCoins` | `CoinInfo`[] | New coins created by transaction, for which wallet will watch for |

##### Returns

`Promise`\<`Transaction`\>

Proved transaction or error

___

### balanceTransaction

• **balanceTransaction**: (`tx`: `Transaction`, `newCoins`: `CoinInfo`[]) => `Promise`\<`BalanceTransactionToProve` \| `NothingToProve`\>

#### Type declaration

▸ (`tx`, `newCoins`): `Promise`\<`BalanceTransactionToProve` \| `NothingToProve`\>

##### Parameters

| Name | Type |
| :------ | :------ |
| `tx` | `Transaction` |
| `newCoins` | `CoinInfo`[] |

##### Returns

`Promise`\<`BalanceTransactionToProve` \| `NothingToProve`\>

**`Deprecated`**

Since version 1.1 and will be deleted in version 2.0.0. Please use `balanceAndProveTransaction` method instead.

___

### proveTransaction

• **proveTransaction**: (`recipe`: `ProvingRecipe`) => `Promise`\<`Transaction`\>

#### Type declaration

▸ (`recipe`): `Promise`\<`Transaction`\>

##### Parameters

| Name | Type |
| :------ | :------ |
| `recipe` | `ProvingRecipe` |

##### Returns

`Promise`\<`Transaction`\>

**`Deprecated`**

Since version 1.1.0 and will be deleted in version 2.0.0. Please use `balanceAndProveTransaction` method instead.

___

### state

• **state**: () => `Promise`\<[`DAppConnectorWalletState`](DAppConnectorWalletState.md)\>

#### Type declaration

▸ (): `Promise`\<[`DAppConnectorWalletState`](DAppConnectorWalletState.md)\>

Returns a promise with the exposed wallet state

##### Returns

`Promise`\<[`DAppConnectorWalletState`](DAppConnectorWalletState.md)\>

___

### submitTransaction

• **submitTransaction**: (`tx`: `Transaction`) => `Promise`\<`string`\>

#### Type declaration

▸ (`tx`): `Promise`\<`string`\>

It will submit given transaction to the node

##### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `tx` | `Transaction` | Transaction to submit |

##### Returns

`Promise`\<`string`\>

First transaction identifier from identifiers list or error
