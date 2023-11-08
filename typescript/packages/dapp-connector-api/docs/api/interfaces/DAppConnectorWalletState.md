[DApp Connector API Reference - v1.0.0](../README.md) / [Exports](../modules.md) / DAppConnectorWalletState

# Interface: DAppConnectorWalletState

The shape of the wallet state that must be exposed

## Table of contents

### Properties

- [address](DAppConnectorWalletState.md#address)
- [coinPublicKey](DAppConnectorWalletState.md#coinpublickey)
- [encryptionPublicKey](DAppConnectorWalletState.md#encryptionpublickey)

## Properties

### address

• **address**: `string`

The wallet address, which is a concatenation of coinPublicKey and encryptionPublicKey

#### Defined in

[api.ts:8](https://github.com/input-output-hk/midnight-wallet/blob/6a617cb/typescript/packages/dapp-connector-api/src/api.ts#L8)

___

### coinPublicKey

• **coinPublicKey**: `string`

The coin public key

#### Defined in

[api.ts:10](https://github.com/input-output-hk/midnight-wallet/blob/6a617cb/typescript/packages/dapp-connector-api/src/api.ts#L10)

___

### encryptionPublicKey

• **encryptionPublicKey**: `string`

The encryption public key

#### Defined in

[api.ts:12](https://github.com/input-output-hk/midnight-wallet/blob/6a617cb/typescript/packages/dapp-connector-api/src/api.ts#L12)
