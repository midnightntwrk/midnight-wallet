[DApp Connector API Reference - v3.1.2](../README.md) / [Exports](../modules.md) / DAppConnectorAPI

# Interface: DAppConnectorAPI

DApp Connector API Definition

When errors occur in functions returning a promise, they should be thrown in the form of an [APIError](../classes/APIError.md).

## Table of contents

### Properties

- [apiVersion](DAppConnectorAPI.md#apiversion)
- [enable](DAppConnectorAPI.md#enable)
- [isEnabled](DAppConnectorAPI.md#isenabled)
- [name](DAppConnectorAPI.md#name)
- [serviceUriConfig](DAppConnectorAPI.md#serviceuriconfig)

## Properties

### apiVersion

• **apiVersion**: `string`

Semver string. DApps are encouraged to check the compatibility whenever this changes.

#### Defined in

[api.ts:46](https://github.com/input-output-hk/midnight-wallet/blob/d3a4d43/typescript/packages/dapp-connector-api/src/api.ts#L46)

___

### enable

• **enable**: () => `Promise`<[`DAppConnectorWalletAPI`](../modules.md#dappconnectorwalletapi)\>

#### Type declaration

▸ (): `Promise`<[`DAppConnectorWalletAPI`](../modules.md#dappconnectorwalletapi)\>

Request access to the wallet, returns the wallet api on approval

##### Returns

`Promise`<[`DAppConnectorWalletAPI`](../modules.md#dappconnectorwalletapi)\>

#### Defined in

[api.ts:52](https://github.com/input-output-hk/midnight-wallet/blob/d3a4d43/typescript/packages/dapp-connector-api/src/api.ts#L52)

___

### isEnabled

• **isEnabled**: () => `Promise`<`boolean`\>

#### Type declaration

▸ (): `Promise`<`boolean`\>

Check if the wallet has authorized the dapp

##### Returns

`Promise`<`boolean`\>

#### Defined in

[api.ts:48](https://github.com/input-output-hk/midnight-wallet/blob/d3a4d43/typescript/packages/dapp-connector-api/src/api.ts#L48)

___

### name

• **name**: `string`

The name of the wallet

#### Defined in

[api.ts:44](https://github.com/input-output-hk/midnight-wallet/blob/d3a4d43/typescript/packages/dapp-connector-api/src/api.ts#L44)

___

### serviceUriConfig

• **serviceUriConfig**: () => `Promise`<[`ServiceUriConfig`](ServiceUriConfig.md)\>

#### Type declaration

▸ (): `Promise`<[`ServiceUriConfig`](ServiceUriConfig.md)\>

Request the services (pubsub, node and proof server) uris.

##### Returns

`Promise`<[`ServiceUriConfig`](ServiceUriConfig.md)\>

#### Defined in

[api.ts:50](https://github.com/input-output-hk/midnight-wallet/blob/d3a4d43/typescript/packages/dapp-connector-api/src/api.ts#L50)
