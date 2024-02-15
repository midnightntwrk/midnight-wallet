**[@midnight-ntwrk/dapp-connector-api v1.1.0](https://github.com/input-output-hk/midnight-wallet/typescript/dapp-connector-api)** • [Readme](../README.md) \| [API](../globals.md)

***

[@midnight-ntwrk/dapp-connector-api v1.1.0](../README.md) / APIError

# Class: APIError

Whenever there's a function called that returns a promise,
an error with the shape can be thrown.

## Extends

- `CustomError`

## Constructors

### new APIError(code, reason)

> **new APIError**(`code`, `reason`): [`APIError`](APIError.md)

#### Parameters

• **code**: [`ErrorCode`](../type-aliases/ErrorCode.md)

• **reason**: `string`

#### Returns

[`APIError`](APIError.md)

#### Overrides

`CustomError.constructor`

## Properties

### code

> **code**: [`ErrorCode`](../type-aliases/ErrorCode.md)

The code of the error that's thrown

***

### reason

> **reason**: `string`

The reason the error is thrown
