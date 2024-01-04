[DApp Connector API Reference - v1.0.0](../README.md) / [Exports](../modules.md) / DAppConnectorAPI

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

___

### enable

• **enable**: () => `Promise`\<[`DAppConnectorWalletAPI`](../modules.md#dappconnectorwalletapi)\>

#### Type declaration

▸ (): `Promise`\<[`DAppConnectorWalletAPI`](../modules.md#dappconnectorwalletapi)\>

Request access to the wallet, returns the wallet api on approval

##### Returns

`Promise`\<[`DAppConnectorWalletAPI`](../modules.md#dappconnectorwalletapi)\>

___

### isEnabled

• **isEnabled**: () => `Promise`\<`boolean`\>

#### Type declaration

▸ (): `Promise`\<`boolean`\>

Check if the wallet has authorized the dapp

##### Returns

`Promise`\<`boolean`\>

___

### name

• **name**: `string`

The name of the wallet

___

### serviceUriConfig

• **serviceUriConfig**: () => `Promise`\<[`ServiceUriConfig`](ServiceUriConfig.md)\>

#### Type declaration

▸ (): `Promise`\<[`ServiceUriConfig`](ServiceUriConfig.md)\>

Request the services (pubsub, node and proof server) uris.

##### Returns

`Promise`\<[`ServiceUriConfig`](ServiceUriConfig.md)\>
