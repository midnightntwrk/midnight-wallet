[DApp Connector API Reference - v1.0.0](../README.md) / [Exports](../modules.md) / APIError

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

• **new APIError**(`code`, `reason`): [`APIError`](APIError.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `code` | [`ErrorCode`](../modules.md#errorcode) |
| `reason` | `string` |

#### Returns

[`APIError`](APIError.md)

## Properties

### code

• **code**: [`ErrorCode`](../modules.md#errorcode)

The code of the error that's thrown

___

### reason

• **reason**: `string`

The reason the error is thrown
