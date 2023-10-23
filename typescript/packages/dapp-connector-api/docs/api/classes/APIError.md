[DApp Connector API Reference - v3.1.2](../README.md) / [Exports](../modules.md) / APIError

# Class: APIError

Whenever there's a function called that returns a promise,
an error with the shape can be thrown.

## Table of contents

### Constructors

- [constructor](APIError.md#constructor)

### Properties

- [code](APIError.md#code)
- [reason](APIError.md#reason)

## Constructors

### constructor

• **new APIError**(`code`, `reason`)

#### Parameters

| Name | Type |
| :------ | :------ |
| `code` | [`ErrorCode`](../modules.md#errorcode) |
| `reason` | `string` |

#### Defined in

[errors.ts:28](https://github.com/input-output-hk/midnight-wallet/blob/d3a4d43/typescript/packages/dapp-connector-api/src/errors.ts#L28)

## Properties

### code

• **code**: [`ErrorCode`](../modules.md#errorcode)

The code of the error that's thrown

#### Defined in

[errors.ts:24](https://github.com/input-output-hk/midnight-wallet/blob/d3a4d43/typescript/packages/dapp-connector-api/src/errors.ts#L24)

___

### reason

• **reason**: `string`

The reason the error is thrown

#### Defined in

[errors.ts:26](https://github.com/input-output-hk/midnight-wallet/blob/d3a4d43/typescript/packages/dapp-connector-api/src/errors.ts#L26)
