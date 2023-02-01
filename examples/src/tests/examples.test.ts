import { distinct, find, firstValueFrom, take } from 'rxjs';
import type { MockedNode, Transaction } from '@midnight/mocked-node-api';
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
import { HasBalance, Resource, WalletBuilder } from '@midnight/wallet';
import type { Filter, FilterService, Wallet } from '@midnight/wallet-api';
import {
  Genesis,
  InMemoryMockedNode,
  LedgerNapi,
} from '@midnight/mocked-node-in-memory';

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

describe('Wallet client example', () => {
  let mockedNode: MockedNode<Transaction>;
  let wallet: FilterService & Wallet & HasBalance & Resource;

  beforeEach(async () => {
    // Create the wallet local state
    // This holds priv/pub keys, coins, and private state of contracts
    const serializedInitialState = WalletBuilder.generateInitialState();
    const localState = deserializeLocalState(serializedInitialState);

    // Create an initial tx minting money for the wallet
    const initialCoin = new CoinInfo(initialBalance, tokenType);
    localState.watchFor(initialCoin);
    const mintTx = buildMintTx(initialCoin, localState.coinPublicKey);

    // Create a mocked-node instance with the mint tx in the genesis block
    const genesis: Genesis<Transaction> = {
      tag: 'value',
      transactions: [serializeTx(mintTx)],
    };
    mockedNode = new InMemoryMockedNode(genesis, new LedgerNapi());

    // Create a wallet instance that connects to the mocked-node
    // Initial state is set up to receive funds from the mint tx
    wallet = await WalletBuilder.build(
      mockedNode,
      serializeLocalState(localState),
      'warn',
    );
    // Run wallet: start syncing blocks
    // This is necessary to have local state updated
    wallet.start();
  });

  afterEach(async () => {
    // Stop syncing
    await wallet.close();
  });

  test('Submit a tx', async () => {
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
  });
});
