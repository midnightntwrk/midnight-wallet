# Midnight wallet

## Installing

The Midnight wallet is provided as an NPM package under the namespace `@midnight-ntwrk/wallet`. You can install it using any node package manager, including Yarn. To install the package using Yarn, run the following command:

`yarn add @midnight-ntwrk/wallet`

## Important information

The wallet uses the `@midnight-ntwrk/zswap` library to manage its local state and construct transactions. The serialization formatting, which ensures transactions are processed correctly depending on the network (eg, TestNet or MainNet) they belong to, relies on the [`NetworkId`](https://docs.midnight.network/develop/reference/midnight-api/zswap/enumerations/NetworkId.md) provided when building the wallet.

---

## Instantiating

The `@midnight-ntwrk/wallet` package offers a builder that enables you to create multiple wallets. Once created and started, each wallet will automatically connect to the specified node, indexer, and proving server.

To create a wallet instance, begin by importing the builder from the `@midnight-ntwrk/wallet` package:

```ts
import { WalletBuilder } from '@midnight-ntwrk/wallet';
```

Next, use the wallet builder to create a new wallet instance. This requires the following parameters (in the precise order):

| Name | Data type | Required? | Default |
|---|---|---|---|
| **Indexer URL** | String  | Yes | N/A |
| **Indexer WebSocket URL** | String  | Yes | N/A |
| **Proving server URL** | String  | Yes | N/A |
| **Node URL** | String  | Yes | N/A |
| **Network ID** | NetworkId | Yes | N/A |
| **Log level** | LogLevel  | No | warn |
| **Discard Transaction History** | Boolean  | No | false |


```ts
import { WalletBuilder } from '@midnight-ntwrk/wallet';
import { NetworkId } from '@midnight-ntwrk/zswap';

const wallet = await WalletBuilder.build(
  'https://indexer.testnet.midnight.network/api/v1/graphql', // Indexer URL
  'wss://indexer.testnet.midnight.network/api/v1/graphql', // Indexer WebSocket URL
  'http://localhost:6300', // Proving Server URL
  'https://rpc.testnet.midnight.network', // Node URL
  NetworkId.TestNet, // Network ID
  'error' // LogLevel
);
```

To begin synchronizing the wallet with the indexer, start the `wallet` variable, which holds an instance of the wallet and resource types from the wallet API, using the following method:

```ts
 wallet.start();
```

## Getting the wallet state

The [wallet state](https://docs.midnight.network/develop/reference/midnight-api/wallet-api/type-aliases/WalletState) is provided through an `rx.js` observable. You can retrieve the state value using various methods supported by `rx.js`. Here's an example:

```ts
wallet.state().subscribe((state) => {
  console.log(state);
});
```

## Balancing a transaction

To balance a transaction, you need to use the `balanceTransaction` method, which requires the following parameters:

| Name | Data type | Required? |
|---|---|---|
| **transaction** | Transaction  | Yes |
| **newCoins** | LogLevel  | No |

> The `newCoins` parameter is intended for cases where a new coin is created, such as when a DApp mints one and intends to send it to the wallet. Due to the nature of the Midnight TestNet,
> these newly created coins must be explicitly provided to the wallet using this method. This allows the wallet to monitor and incorporate them into its state effectively.

```ts
const balancedTransaction = await wallet.balanceTransaction(transaction);
```

## Proving a transaction

To prove a transaction, you need to use the `proveTransaction` method, which requires the following parameters:

| Name | Data type | Required? |
|---|---|---|
| **provingRecipe** | ProvingRecipe  | Yes |


This example uses the `unprovenTransaction` from the section above:

```ts
import { TRANSACTION_TO_PROVE } from '@midnight-ntwrk/wallet-api';

const recipe = {
  type: TRANSACTION_TO_PROVE, // available from the Wallet API
  transaction: balancedTransaction // this is a balanced, unproven transaction
};

const provenTransaction = await wallet.proveTransaction(recipe);
```


## Submitting a transaction

To submit a transaction, you need to use the `submitTransaction` method, which requires the following parameters:

| Name | Data type | Required? |
|---|---|---|
| **transaction** | Transaction  | Yes |


The transaction must be balanced and proven (in this order) for it to be accepted by the node.

The example below uses the `provenTransaction` from the section above:

```ts
const submittedTransaction = await wallet.submitTransaction(provenTransaction);
```

## Transferring transaction API

The wallet API includes a `transferTransaction()` method that enables you to construct transactions specifying the token type, amount, and recipient address. You can then validate and submit these transactions to the node.

This method requires an array of objects containing the following properties:

| Name | Data type | Required? |
|---|---|---|
| **amount** | BigInt  | Yes |
| **tokenType** | TokenType | Yes |
| **receiverAddress** | Address | Yes |


Below, you can see an example of how you can utilize the API:

```ts
const transactionToProve = await wallet.transferTransaction([
  {
    amount: 1n,
    receiverAddress: '<midnight-wallet-address>',
    tokenType: '0100010000000000000000000000000000000000000000000000000000000000000000' // tDUST token type
  }
]);
```

## Serializing state

The wallet state can be serialized, allowing it to be stored and later re-instantiated from that serialized checkpoint.

To serialize the state, use the `serialize()` method as follows:

```ts
const serializedState = await wallet.serializeState();
```

## Instantiating from the serialized state

The wallet builder offers a method to create a wallet instance from the serialized state ([learn more about the serialized state here](#serializing-state)). This method requires the following parameters (in the precise order):

| Name | Data type | Required? |
|---|---|---|
| **Indexer URL** | String  | Yes |
| **Indexer WebSocket URL** | String  | Yes |
| **Proving server URL** | String  | Yes |
| **Node URL** | String  | Yes |
| **Serialized state** | String  | Yes |
| **Log level** | LogLevel  | No |
| **Discard Transaction History** | Boolean  | No | false |


The example below uses the `serializedState` variable from the example above:

```ts
import { WalletBuilder } from '@midnight-ntwrk/wallet';

const wallet = await WalletBuilder.restore(
  'https://indexer.testnet.midnight.network/api/v1/graphql', // Indexer URL
  'wss://indexer.testnet.midnight.network/api/v1/graphql', // Indexer WebSocket URL
  'http://localhost:6300', // Proving Server URL
  'https://rpc.testnet.midnight.network', // Node URL
  serializedState,
  'error' // LogLevel
);
```

This will create a wallet with its state checkpoint set to the time when you called the `serializeState()` method. Once the wallet is started with `wallet.start()`, it will begin syncing and updating the state from that point onward.

This functionality is especially valuable in scenarios like browser extensions, where it's crucial to swiftly restore the wallet state for the user.

Note that this builder method doesn't provide a network ID parameter, because it is stored in the serialized snapshot.

## Instantiating from a seed

The wallet builder offers a method that enables you to instantiate a wallet with a specific seed, resulting in obtaining the same address and keys but with a fresh state that is then synchronized with the indexer. The method requires the following parameters (in the exact order):

| Name | Data type | Required? |
|---|---|---|
| **Indexer URL** | String  | Yes |
| **Indexer WebSocket URL** | String  | Yes |
| **Proving server URL** | String  | Yes |
| **Node URL** | String  | Yes |
| **Seed** | String  | Yes |
| **Network ID** | NetworkId | Yes |
| **Log level** | LogLevel  | No |
| **Discard Transaction History** | Boolean  | No | false |


```ts
import { WalletBuilder } from '@midnight-ntwrk/wallet';
import { NetworkId } from '@midnight-ntwrk/zswap';

const wallet = await WalletBuilder.buildFromSeed(
  'https://indexer.testnet.midnight.network/api/v1/graphql', // Indexer URL
  'wss://indexer.testnet.midnight.network/api/v1/graphql', // Indexer WebSocket URL
  'http://localhost:6300', // Proving Server URL
  'https://rpc.testnet.midnight.network', // Node URL
  '0000000000000000000000000000000000000000000000000000000000000000', // Seed
  NetworkId.TestNet,
  'error' // LogLevel
);
```

## Closing an instance

To gracefully close a wallet instance, use the `close()` method:

```ts
await wallet.close();
```


## Examples

In this section, you'll find examples of how you can fully utilize the wallet APIs.

### Transferring tDUST

This example instantiates a new wallet and uses it to transfer one tDUST to another wallet:

```ts
import { WalletBuilder } from '@midnight-ntwrk/wallet';
import { NetworkId } from '@midnight-ntwrk/zswap';

try {
  const wallet = await WalletBuilder.build(
    'https://indexer.testnet.midnight.network/api/v1/graphql',
    'wss://indexer.testnet.midnight.network/api/v1/graphql',
    'http://localhost:6300',
    'https://rpc.testnet.midnight.network',
    NetworkId.TestNet
  );

  const transactionToProve = await wallet.transferTransaction([
    {
      amount: 1n,
      tokenType: '0100010000000000000000000000000000000000000000000000000000000000000000', // tDUST token type
      receiverAddress: '2f646b14cbcbfc43ccdae6379891c2b01e9731d1e4c1e0c1b71c04b7948a3e0e|010001f38d17a48161d6248ee10a799dca0799eecbd8f1f20bbeb4eb2645656c104cde'
    }
  ]);

  const provenTransaction = await wallet.proveTransaction(transactionToProve);

  const submittedTransaction = await wallet.submitTransaction(provenTransaction);

  console.log('Transaction submitted', submittedTransaction);
} catch (error) {
  console.log('An error occurred', error);
}
```
