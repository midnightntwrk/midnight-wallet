**@midnight-ntwrk/dapp-connector-api v1.1.0** • Readme \| [API](globals.md)

***

# Midnight DApp connector API

This API provides a comprehensive interface for the DApp connector operations, defining the structure of the wallet state it exposes, the methods for interacting with it, and the types and variables used within.

It's implemented by the Midnight Lace extension for Google Chrome and is injected in the global scope (`window.midnight.mnLace`) of DApps running in browser.

## Installation

The Midnight DApp connector API is available as an NPM package with the namespace `@midnight-ntwrk/dapp-connector-api`. It can be installed using any Node package manager, such as yarn. To install the package using yarn, please execute the following command:

`yarn add @midnight-ntwrk/dapp-connector-api`

## Package Usage

The package provides the type declarations that are documented in the [documentation](interfaces/DAppConnectorAPI.md) of this package.

The dapp connector api should be exposed through the global variable, in the following namespace:

`window.midnight.{walletName}`

## Available methods

| Name | Description |
|---|---|
| **apiVersion** | Provides a semver string version of the dapp connector api  |
| **enable** | Returns a promise with the [DAppConnectorWalletAPI](interfaces/DAppConnectorWalletAPI.md) or error |
| **isEnabled** | Returns a promise with a boolean showing whether the dapp is authorized to access the api or not |
| **name** | The name of the wallet that implements the api |
| **serviceUriConfig** | Returns a promise with [ServiceUriConfig](interfaces/ServiceUriConfig.md) or error if the dapp is not authorized. |

## API Usage

We're going to use the Midnight Lace implementation of the DApp connector API for the examples below which is available in this namespace: `window.midnight.mnLace`.

## Authorizing DApp

To authorize a dapp, call the `enable()` method and wait for the user to respond to the authorize request.

```ts
try {
  const api = await window.midnight.mnLace.enable();

  // api is available here
} catch (error) {
  console.log('an error occurred', error);
}
```

## Checking if the DApp is authorized

To check if the DApp is authorized, please use the `isEnabled()` method as follows:

```ts
try {
  const isEnabled = await window.midnight.mnLace.isEnabled();
} catch (error) {
  console.log('an error occurred', error);
}
```

## Getting information about the DApp connector API

### Name
To get the name of the wallet, use the `name` property in the implemented DApp connector API:

```ts
const name = window.midnight.mnLace.name;

console.log('Wallet name', name);
```

### API Version
To get the api version, use the `apiVersion` property as follows:

```ts
const apiVersion = window.midnight.mnLace.apiVersion;

console.log('API version', apiVersion);
```

### Getting the Service URI Config

Midnight Wallet users can set the node, indexer and proving server uris in the wallet settings.
For DApps to be able to find out those urls, and leverage them, this property is exposed, which contains the following:

| Name | Description |
|---|---|
| **Node URL** | The node the wallet is pointing to  |
| **Indexer URL** | The indexer url the wallet is pointing to |
| **Proving Server URL** | The proving server url the wallet is pointing to |

In order to get the service uri config, use the api as follows:

```ts
try {
  const serviceUriConfig = await window.midnight.mnLace.serviceUriConfig();

  console.log('serviceUriConfig', serviceUriConfig);
} catch (error) {
  console.log('an error occurred', error);
}
```

**Note:** The DApp must be authorized before calling this method, otherwise it will throw an error.

## Interacting with the API

After you call the `enable()` method, and the user approved the authorization request, you'll receive an instance of the [DAppConnectorWalletAPI](interfaces/DAppConnectorWalletAPI.md) which consists of the following properties:

| Name | Description | Note |
|---|---|---|
| **balanceAndProveTransaction** | Balances and proves a transaction  | - |
| **submitTransaction** | Submits a balanced and proven transaction | - |
| **state** | Returns [DAppConnectorWalletState](interfaces/DAppConnectorWalletState.md) object | - |
| **balanceTransaction** | Balances a transaction | This method is deprecated and will be removed in version 2.0.0 |
| **proveTransaction** | Proves a transaction | This method is deprecated and will be removed in version 2.0.0 |

## Getting the wallet state

To get the wallet state, simply call the `state()` api method, which returns a promise with the [DAppConnectorWalletState](interfaces/DAppConnectorWalletState.md) object as follows:

```ts
try {
  const state = await api.state();

  console.log('Wallet state', state);
} catch (error) {
  console.log('an error occurred', error);
}
```

## Balancing and proving a transaction

To balance and prove a transaction, first create a transaction in your dapp ([follow the guide on how to create a transaction here](#)).

This method, accepts the following properties:

| Name | Data Type | Required? |
|---|---|---|
| **transaction** | Transaction  | Yes |
| **newCoins** | CoinInfo[] | No |

Below, you'll find an example how to balance and prove a transaction:

```ts
try {
  // assuming we have a transaction at hand here
  const transaction;

  const balancedAndProvenTransaction = await api.balanceAndProveTransaction(transaction);
} catch (error) {
  console.log('an error occurred', error);
}
```

## Submitting a transaction

Assuming we have the balanced and proven transaction from above, we're going to submit it now.

The `submitTransaction()` method accepts the following parameters:

| Name | Data Type | Required? |
|---|---|---|
| **transaction** | Transaction  | Yes |

Below, you'll find an example how to submit a transaction:

```ts
try {
  const submittedTransaction = await api.submitTransaction(balancedAndProvenTransaction);
} catch (error) {
  console.log('an error occurred', error);
}
```

## Examples
In this section you'll find examples on how you can fully utilize the dapp connector api.

### Submitting a transaction

In this example, we'll authorize and submit a transaction from a DApps perspective using the DApp connector API.

```ts
try {
  const api = await window.midnight.mnLace.enable();

  // assuming this is a transaction we've already created
  // [link to create transaction docs is in the "Balancing and proving a transaction" section]
  const transaction;

  const balancedAndProvenTransaction = await api.balanceAndProveTransaction(transaction);

  const submittedTx = await api.submitTransaction(balancedAndProvenTransaction);

  console.log(submittedTx);
} catch (error) {
  console.log('an error occurred', error);
}
```
