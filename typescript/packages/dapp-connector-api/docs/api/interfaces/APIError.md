[DApp Connector API Reference - v2.9.2](../README.md) / [Exports](../modules.md) / APIError

# Interface: APIError

Whenever there's a function called that returns a promise,
an error with the shape can be thrown.

## Table of contents

### Properties

- [code](APIError.md#code)
- [reason](APIError.md#reason)

## Properties

### code

• **code**: [`ErrorCode`](../modules.md#errorcode)

The code of the error that's thrown

#### Defined in

[errors.ts:24](https://github.com/input-output-hk/midnight-wallet/blob/c3aab45/typescript/packages/dapp-connector-api/src/errors.ts#L24)

___

### reason

• **reason**: `string`

The reason the error is thrown

#### Defined in

[errors.ts:26](https://github.com/input-output-hk/midnight-wallet/blob/c3aab45/typescript/packages/dapp-connector-api/src/errors.ts#L26)
