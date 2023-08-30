[DApp Connector API Reference - v2.9.2](../README.md) / [Exports](../modules.md) / DAppConnectorAPI

# Interface: DAppConnectorAPI

DApp Connector API Definition

When errors occur in functions returning a promise, they should be thrown in the form of an [APIError](APIError.md).

## Table of contents

### Properties

- [apiVersion](DAppConnectorAPI.md#apiversion)
- [enable](DAppConnectorAPI.md#enable)
- [isEnabled](DAppConnectorAPI.md#isenabled)
- [name](DAppConnectorAPI.md#name)

## Properties

### apiVersion

• **apiVersion**: `string`

The version of the api

#### Defined in

[api.ts:32](https://github.com/input-output-hk/midnight-wallet/blob/c3aab45/typescript/packages/dapp-connector-api/src/api.ts#L32)

___

### enable

• **enable**: `Promise`<[`DAppConnectorWalletAPI`](../modules.md#dappconnectorwalletapi)\>

Request access to the wallet, returns the wallet api on approval

#### Defined in

[api.ts:36](https://github.com/input-output-hk/midnight-wallet/blob/c3aab45/typescript/packages/dapp-connector-api/src/api.ts#L36)

___

### isEnabled

• **isEnabled**: `Promise`<`boolean`\>

Check if the wallet has authorized the dapp

#### Defined in

[api.ts:34](https://github.com/input-output-hk/midnight-wallet/blob/c3aab45/typescript/packages/dapp-connector-api/src/api.ts#L34)

___

### name

• **name**: `string`

The name of the wallet

#### Defined in

[api.ts:30](https://github.com/input-output-hk/midnight-wallet/blob/c3aab45/typescript/packages/dapp-connector-api/src/api.ts#L30)
