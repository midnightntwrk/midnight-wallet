import {
  distinct,
  find,
  firstValueFrom,
  Observable,
  take,
  toArray,
} from 'rxjs';
import type {
  Block,
  Transaction,
  TxSubmissionResult,
} from '@midnight/mocked-node-api';
import {
  CoinInfo,
  LedgerState,
  nativeToken,
  Transaction as LedgerTransaction,
  TransactionBuilder,
  ZSwapCoinPublicKey,
  ZSwapDeltas,
  ZSwapLocalState,
  ZSwapOffer,
  ZSwapOutputWithRandomness,
} from '@midnight/ledger';
import {
  HasBalance,
  Resource,
  WalletBuilder,
  SyncSession,
  SubmitSession,
} from '@midnight/wallet';
import type { Filter, FilterService, Wallet } from '@midnight/wallet-api';
import { InMemoryServer } from '@midnight/mocked-node-app';
import {
  Genesis,
  InMemoryMockedNode,
  LedgerNapi,
} from '@midnight/mocked-node-in-memory';

import * as mnc from '@midnight/mocked-node-client';
import pino from 'pino';
import type { MockedNodeClient } from '@midnight/mocked-node-client';

const tokenType = nativeToken();
const initialBalance = 1_000_000n;
const isLedgerNoProofs = process.env.NO_PROOFS === 'true';
const txFee = isLedgerNoProofs ? 2403n : 5585n;

const buildMintTx = (
  coin: CoinInfo,
  recipient: ZSwapCoinPublicKey,
): LedgerTransaction => {
  const output = ZSwapOutputWithRandomness.new(coin, recipient);
  const deltas = new ZSwapDeltas();
  deltas.insert(tokenType, -coin.value);
  const offer = new ZSwapOffer([], [output.output], [], deltas);
  const builder = new TransactionBuilder(new LedgerState());
  builder.addOffer(offer, output.randomness);
  return builder.intoTransaction().transaction;
};

const serializeTx = (ledgerTx: LedgerTransaction): Transaction => {
  return {
    header: { hash: ledgerTx.transactionHash().serialize().toString('hex') },
    body: ledgerTx.serialize().toString('base64'),
  };
};

const serializeLocalState = (state: ZSwapLocalState): string => {
  return state.serialize().toString('base64');
};

const deserializeLocalState = (state: string): ZSwapLocalState => {
  return ZSwapLocalState.deserialize(Buffer.from(state, 'base64'));
};

const prepareLocalStateAndMintTx = (): [string, LedgerTransaction] => {
  // Create the wallet local state
  // This holds priv/pub keys, coins, and private state of contracts
  const serializedInitialState = WalletBuilder.generateInitialState();
  const localState = deserializeLocalState(serializedInitialState);

  // Create an initial tx minting money for the wallet
  const initialCoin = new CoinInfo(initialBalance, tokenType);
  localState.watchFor(initialCoin);
  const mintTx = buildMintTx(initialCoin, localState.coinPublicKey);
  const serializedLocalState = serializeLocalState(localState);

  return [serializedLocalState, mintTx];
};

const logger = pino({
  level: 'error',
});

type WalletType = FilterService & Wallet & HasBalance & Resource;

const testSpec = (
  specName: string,
  testName: string,
  setupWallet: () => Promise<WalletType>,
  additionalTest: () => Promise<void>,
  tearDown: () => Promise<void>,
): void => {
  describe(specName, () => {
    let wallet: WalletType;

    beforeEach(async () => {
      wallet = await setupWallet();

      // Run wallet: start syncing blocks
      // This is necessary to have local state updated
      wallet.start();
    });

    afterEach(async () => {
      // Stop syncing
      await wallet.close();
      await tearDown();
    });

    test(testName, async () => {
      // Subscribe to wallet balance changes
      const balanceHistory: bigint[] = [];
      wallet
        .balance()
        .pipe(distinct(), take(3))
        .subscribe((b) => balanceHistory.push(b));

      // Wait until wallet is synced and received the initial coin
      await firstValueFrom(
        wallet.balance().pipe(find((balance) => balance === initialBalance)),
      );

      // We can create a mint tx without inputs, because
      // the wallet will balance it with its own coins
      const spendCoin = new CoinInfo(10_000n, tokenType);
      const randomRecipient = new ZSwapLocalState().coinPublicKey;
      const unbalancedTx = buildMintTx(spendCoin, randomRecipient);

      // Submit the tx, get an identifier back
      const submittedTxId = await firstValueFrom(
        wallet.submitTx(unbalancedTx, []),
      );

      // Install a filter waiting for the submitted tx
      const filter: Filter<LedgerTransaction> = {
        apply(arg: LedgerTransaction): boolean {
          return arg.hasIdentifier(submittedTxId);
        },
      };

      const filteredTx = await firstValueFrom(wallet.installTxFilter(filter));

      // Double-check that the filtered tx is what we want
      expect(filteredTx.hasIdentifier(submittedTxId)).toBeTruthy();

      expect(balanceHistory).toEqual([
        0n, // Starts with 0
        initialBalance, // Receives mint tx
        initialBalance - spendCoin.value - txFee, // Spends (spendCoin + fee)
      ]);

      await additionalTest();
    });
  });
};

describe('Mocked node instance and simple wallet flow (submit tx, check balance)', () => {
  const setup = async (): Promise<WalletType> => {
    const [serializedLocalState, mintTx] = prepareLocalStateAndMintTx();

    // Create a mocked-node instance with the mint tx in the genesis block
    const genesis: Genesis<Transaction> = {
      tag: 'value',
      transactions: [serializeTx(mintTx)],
    };
    const mockedNode: InMemoryMockedNode<Transaction, LedgerState> =
      new InMemoryMockedNode(genesis, new LedgerNapi(), logger);

    const nodeConnection = {
      async startSyncSession(): Promise<SyncSession> {
        const chain = mockedNode.sync();
        const syncSession: SyncSession = {
          sync(): Observable<Block<Transaction>> {
            return chain.sync();
          },
          close(): void {},
        };

        return await Promise.resolve(syncSession);
      },

      async startSubmitSession(): Promise<SubmitSession> {
        const submitSession: SubmitSession = {
          async submitTx(tx: Transaction): Promise<TxSubmissionResult> {
            return await mockedNode.submitTx(tx);
          },
          close(): void {},
        };
        return await Promise.resolve(submitSession);
      },
    };

    return await WalletBuilder.build(
      nodeConnection,
      serializedLocalState,
      'error',
    );
  };

  const noAdditionalTest = async (): Promise<void> => {
    return await Promise.resolve();
  };

  const noTearDown = async (): Promise<void> => {
    return await Promise.resolve();
  };

  testSpec(
    'Wallet client example',
    'Submit a tx',
    setup,
    noAdditionalTest,
    noTearDown,
  );
});

describe('MockedNode as InMemoryServer and MockedNodeClient flow (syncing transactions)', () => {
  let mockedNode: InMemoryServer;
  let mockedNodeClient: MockedNodeClient<Transaction>;

  const setup = async (): Promise<WalletType> => {
    const [serializedLocalState, mintTx] = prepareLocalStateAndMintTx();

    const nodeHost = 'localhost';
    const nodePort = 5205;
    const nodeUri = `ws://${nodeHost}:${nodePort}`;

    mockedNode = new InMemoryServer({
      host: nodeHost,
      port: nodePort,
      genesis: { tag: 'value', transactions: [serializeTx(mintTx)] },
    });

    await mockedNode.run();

    mockedNodeClient = await mnc.client(nodeUri, logger);

    // Create a wallet instance that connects to the mocked-node
    // Initial state is set up to receive funds from the mint tx
    return await WalletBuilder.connect(nodeUri, serializedLocalState, 'error');
  };

  const additionalTest = async (): Promise<void> => {
    // Check synced txs (they're two, genesis and unbalancedTx)
    const syncedTxs = await firstValueFrom(
      mockedNodeClient.sync().pipe(take(2), toArray()),
    );
    expect(syncedTxs.length).toBe(2);
  };

  const tearDown = async (): Promise<void> => {
    mockedNodeClient.close();
    await mockedNode.close();
  };

  testSpec(
    'Mocked Node Client',
    'Sync all transactions',
    setup,
    additionalTest,
    tearDown,
  );
});
