[DApp Connector API Reference - v1.1.0](README.md) / Exports

# DApp Connector API Reference - v1.1.0

## Table of contents

### Classes

- [APIError](classes/APIError.md)

### Interfaces

- [DAppConnectorAPI](interfaces/DAppConnectorAPI.md)
- [DAppConnectorWalletAPI](interfaces/DAppConnectorWalletAPI.md)
- [DAppConnectorWalletState](interfaces/DAppConnectorWalletState.md)
- [ServiceUriConfig](interfaces/ServiceUriConfig.md)

### Type Aliases

- [ErrorCode](modules.md#errorcode)

### Variables

- [ErrorCodes](modules.md#errorcodes)

## Type Aliases

### ErrorCode

Ƭ **ErrorCode**: typeof [`ErrorCodes`](modules.md#errorcodes)[keyof typeof [`ErrorCodes`](modules.md#errorcodes)]

ErrorCode type definition

## Variables

### ErrorCodes

• `Const` **ErrorCodes**: `Object`

The following error codes can be thrown by the dapp connector.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `InternalError` | ``"InternalError"`` | The dapp connector wasn't able to process the request |
| `InvalidRequest` | ``"InvalidRequest"`` | Can be thrown in various circumstances, e.g. one being a malformed transaction |
| `Rejected` | ``"Rejected"`` | The user rejected the request |
