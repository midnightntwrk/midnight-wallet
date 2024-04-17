# Midnight Wallet

## Installation

The Midnight Wallet is available as an NPM package with the namespace `@midnight-ntwrk/wallet`. It can be installed using any Node package manager, such as yarn. To install the package using yarn, please execute the following command:

`yarn add @midnight-ntwrk/wallet`

## Important information!
The wallet utilizes the `@midnight-ntwrk/zswap` library to manage its local state and build transactions. The serialization formatting, which ensures that transactions are processed correctly based on the network they belong to (e.g., testnet or mainnet), depends on the Network ID set in the library's context.

When instantiating the wallet in any context, it is crucial to set the appropriate Network ID. To achieve this, import the `setNetworkId` function from `@midnight-ntwrk/zswap` and invoke it before creating the wallet instance.

For more information on available Network IDs, please refer to the [relevant section](https://docs.midnight.network/develop/reference/midnight-api/zswap/#network-id).

Below, you can find an example how to set the Network ID for the DevNet network:

```ts
import { setNetworkId, NetworkId } from '@midnight-ntwrk/zswap';

setNetworkId(NetworkId.DevNet);
```


## Instantiation

The `@midnight-ntwrk/wallet` package provides a builder that allows you to instantiate an arbitrary number of wallets. Once a wallet is instantiated and started, it will automatically connect to the provided Node, Indexer, and Proving Server.

To instantiate the wallet, first import the builder from the `@midnight-ntwrk/wallet` package:


```ts
import { WalletBuilder } from '@midnight-ntwrk/wallet';
```

Next, utilize the wallet builder to create a new instance of the wallet. This requires providing the following parameters (in the precise order):

| Name | Data Type | Required? | Default |
|---|---|---|---|
| **Indexer URL** | String  | Yes | N/A |
| **Indexer WebSocket URL** | String  | Yes | N/A |
| **Proving Server URL** | String  | Yes | N/A |
| **Node URL** | String  | Yes | N/A |
| **Log Level** | LogLevel  | No | warn |


```ts
import { WalletBuilder } from '@midnight-ntwrk/wallet';

const wallet = await WalletBuilder.build(
  'https://pubsub.jade.midnight.network/api/v1/graphql', // Indexer URL
  'wss://pubsub.jade.midnight.network/ws/api/v1/graphql', // Indexer WebSocket URL
  'http://localhost:6300', // Proving Server URL
  'http://node-01.jade.midnight.network:9944', // Node URL
  'error' // LogLevel
);
```

To initiate the synchronization of the wallet with the indexer, the `wallet` variable, which holds an instance of the Wallet & Resource types (available in the wallet api), needs to be started using the following method:

```ts
 wallet.start();
```

## Getting Wallet State

The [Wallet State](https://docs.midnight.network/develop/reference/midnight-api/wallet-api/type-aliases/WalletState) is provided through an rx.js observable, the value of the state can be obtained using various methods supported by rx.js. Here is one example:

```ts
wallet.state().subscribe((state) => {
  console.log(state);
});
```

## Balancing a transaction

To balance a transaction, you need to use the `balanceTransaction` method, which requires the following parameters:

| Name | Data Type | Required? |
|---|---|---|
| **transaction** | Transaction  | Yes |
| **newCoins** | LogLevel  | No |

**Note:** The newCoins parameter should be used in cases where a new coin is created i.e a DApp mints one, and wants to send it to the wallet.
Due to how Midnight works, such newly created coins must be explicitly passed to the wallet in this method, in order for the wallet to be able to
watch over them and add them to its state.

```ts
const balancedTransaction = await wallet.balanceTransaction(transaction);
```

## Proving a transaction

To prove a transaction, you need to use the `proveTransaction` method, which requires the following parameter:

| Name | Data Type | Required? |
|---|---|---|
| **provingRecipe** | ProvingRecipe  | Yes |

We'll be using the `unprovenTransaction` from the section above in this example:

```ts
import { TRANSACTION_TO_PROVE } from '@midnight-ntwrk/wallet-api';

const recipe = {
  type: TRANSACTION_TO_PROVE, // available from the Wallet API
  transaction: balancedTransaction // this is a balanced, unproven transaction
};

const provenTransaction = await wallet.proveTransaction(recipe);
```


## Submitting a transaction

To submit a transaction, you need to use the `submitTransaction` method, which requires the following parameter:

| Name | Data Type | Required? |
|---|---|---|
| **transaction** | Transaction  | Yes |

The transaction must be balanced and proven (in this order) in order for it to be accepted by the node.

In the example below, we'll be using the the provenTransaction from the section above.

```ts
const submittedTransaction = await wallet.submitTransaction(provenTransaction);
```

## Transfer transaction API

The wallet api provides a `transferTransaction()` method which allows you to build a transactions based on the token type, amount and receiver address, which you can then prove and submit to the node.

This method, requires an array of objects which contain the following properties:

| Name | Data Type | Required? |
|---|---|---|
| **amount** | BigInt  | Yes |
| **tokenType** | TokenType | Yes |
| **receiverAddress** | Address | Yes |

Below, you can see an example on how you can utilize the api:

```ts
const transactionToProve = await wallet.transferTransaction([
  {
    amount: 1n,
    receiverAddress: '<midnight-wallet-address>',
    tokenType: '0100010000000000000000000000000000000000000000000000000000000000000000' // tDUST token type
  }
]);
```

## Serializing State

The wallet state can be serialized, allowing it to be stored and later re-instantiated from that serialized checkpoint.

To serialize the state, use the `serialize()` method in the following manner:


```ts
const serializedState = await wallet.serializeState();
```

## Instantiating from serialized state

The wallet builder offers a method to create a wallet instance from the serialized state ([learn more about serialized state here](#serializing-state)). This method requires the following parameters (in the precise order):

| Name | Data Type | Required? |
|---|---|---|
| **Indexer URL** | String  | Yes |
| **Indexer WebSocket URL** | String  | Yes |
| **Proving Server URL** | String  | Yes |
| **Node URL** | String  | Yes |
| **Serialized State** | String  | Yes |
| **Log Level** | LogLevel  | No |

In the example below, we're going to use the `serializedState` variable from the example above.

```ts
import { WalletBuilder } from '@midnight-ntwrk/wallet';

const wallet = await WalletBuilder.restore(
  'https://pubsub.jade.midnight.network/api/v1/graphql', // Indexer URL
  'wss://pubsub.jade.midnight.network/ws/api/v1/graphql', // Indexer WebSocket URL
  'http://localhost:6300', // Proving Server URL
  'http://node-01.jade.midnight.network:9944', // Node URL
  serializedState,
  'error' // LogLevel
);
```

This will instantiate a wallet with it's state checkpoint being the time when we called the `serializeState()` method. Once the wallet is started - `wallet.start()` it will start syncing and updating the state from that point on.

This is particularly useful when using the wallet in cases like browser extension where we need to quickly restore the state of the wallet for the user.

## Instantiating from a seed

The wallet builder provides a method which allows you to instantiate a wallet with a specific seed, this results in getting the same address and keys but with a fresh state which is then synced with the indexer. The method requires the following parameters (in the exact order):

| Name | Data Type | Required? |
|---|---|---|
| **Indexer URL** | String  | Yes |
| **Indexer WebSocket URL** | String  | Yes |
| **Proving Server URL** | String  | Yes |
| **Node URL** | String  | Yes |
| **Seed** | String  | Yes |
| **Log Level** | LogLevel  | No |

```ts
import { WalletBuilder } from '@midnight-ntwrk/wallet';

const wallet = await WalletBuilder.buildFromSeed(
  'https://pubsub.jade.midnight.network/api/v1/graphql', // Indexer URL
  'wss://pubsub.jade.midnight.network/ws/api/v1/graphql', // Indexer WebSocket URL
  'http://localhost:6300', // Proving Server URL
  'http://node-01.jade.midnight.network:9944', // Node URL
  '0000000000000000000000000000000000000000000000000000000000000000', // Seed
  'error' // LogLevel
);
```

## Closing an instance

To gracefully close a wallet instance, please use the `close()` method.

```ts
await wallet.close();
```


## Examples
In this section you'll find examples on how you can fully utilize the wallet apis.

### Transferring tDUST

In this example, we'll instantiate a new wallet, and use it to transfer 1 tDUST to another wallet.

```ts
import { WalletBuilder } from '@midnight-ntwrk/wallet';

try {
  const wallet = await WalletBuilder.build(
    'https://pubsub.jade.midnight.network/api/v1/graphql',
    'wss://pubsub.jade.midnight.network/ws/api/v1/graphql',
    'http://localhost:6300',
    'http://node-01.jade.midnight.network:9944',
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
