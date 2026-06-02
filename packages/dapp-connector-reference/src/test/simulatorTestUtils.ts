/**
 * Simulator-backed test infrastructure for the DApp Connector reference implementation.
 *
 * Creates a real WalletFacade backed by an in-memory Simulator, replacing the mock infrastructure that previously
 * hand-reimplemented facade behavior.
 *
 * Adapted from packages/facade/test/utils/helpers.ts (test code, not importable).
 */

import * as ledger from '@midnight-ntwrk/ledger-v8';
import { HDWallet, Roles } from '@midnight-ntwrk/wallet-sdk-hd';
import {
  type FacadeState,
  WalletFacade,
  WalletEntrySchema,
  mergeWalletEntries,
  type WalletEntry,
  type Clock,
} from '@midnight-ntwrk/wallet-sdk-facade';
import { CustomShieldedWallet, type ShieldedWalletAPI } from '@midnight-ntwrk/wallet-sdk-shielded';
import {
  Sync as ShieldedSync,
  TransactionHistory as ShieldedTransactionHistory,
  V1Builder as ShieldedV1Builder,
} from '@midnight-ntwrk/wallet-sdk-shielded/v1';
import { CustomDustWallet, type DustWalletAPI } from '@midnight-ntwrk/wallet-sdk-dust-wallet';
import {
  SyncService as DustSyncService,
  TransactionHistory as DustTransactionHistory,
  V1Builder as DustV1Builder,
} from '@midnight-ntwrk/wallet-sdk-dust-wallet/v1';
import {
  CustomUnshieldedWallet,
  createKeystore,
  PublicKey,
  type UnshieldedWalletAPI,
} from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import { InMemoryTransactionHistoryStorage, NetworkId } from '@midnight-ntwrk/wallet-sdk-abstractions';
import {
  Sync as UnshieldedSync,
  V1Builder as UnshieldedV1Builder,
} from '@midnight-ntwrk/wallet-sdk-unshielded-wallet/v1';
import * as Submission from '@midnight-ntwrk/wallet-sdk-capabilities/submission';
import type { SubmitTransactionMethod, SubmissionEvent } from '@midnight-ntwrk/wallet-sdk-capabilities/submission';
import {
  makeSimulatorProvingServiceEffect,
  type ProvingService,
  type UnboundTransaction,
} from '@midnight-ntwrk/wallet-sdk-capabilities/proving';
import {
  Simulator,
  immediateBlockProducer,
  type GenesisMint,
} from '@midnight-ntwrk/wallet-sdk-capabilities/simulation';
import type { SubmissionService } from '@midnight-ntwrk/wallet-sdk-capabilities';
import { Effect, Exit, Scope } from 'effect';
import * as rx from 'rxjs';

import { createHash } from 'node:crypto';

import type { WalletKeystore } from '../types.js';
import type {
  DappConnectorTestContext,
  CreateConnectedAPIOptions,
  ConnectedAPIInstance,
  MultiWalletSetup,
  TestEnvironment,
  WalletInitSpec,
  WalletInstance,
} from './context.js';
import { Connector, createMockProvingProviderFactory } from '../index.js';
import type {
  ConnectorConfiguration,
  TransactionHistoryServiceView,
  PaginatedHistoryResult,
  TransactionHistoryEntryView,
  WalletFacadeView,
} from '../types.js';
import type { TxStatus } from '@midnight-ntwrk/dapp-connector-api';
import {
  MidnightBech32m,
  ShieldedAddress,
  ShieldedCoinPublicKey,
  ShieldedEncryptionPublicKey,
  UnshieldedAddress,
} from '@midnight-ntwrk/wallet-sdk-address-format';
import { defaultConnectorMetadataArbitrary, randomValue } from '../testing.js';
import {
  testShieldedWithKeys,
  testShieldedWithKeys2,
  testUnshieldedWithKeys,
  testUnshieldedWithKeys2,
} from './testUtils.js';

// =============================================================================
// HD Key Derivation (adapted from facade test helpers)
// =============================================================================

const getShieldedSeed = (seed: string): Uint8Array => {
  const seedBuffer = Buffer.from(seed, 'hex');
  // Type cast required because: HDWallet.fromSeed returns a union type, we know the seed is valid
  const { hdWallet } = HDWallet.fromSeed(seedBuffer) as { type: 'seedOk'; hdWallet: HDWallet };
  const derivationResult = hdWallet.selectAccount(0).selectRole(Roles.Zswap).deriveKeyAt(0);
  if (derivationResult.type === 'keyOutOfBounds') throw new Error('Key derivation out of bounds');
  return Buffer.from(derivationResult.key);
};

const getUnshieldedSeed = (seed: string): Uint8Array => {
  const seedBuffer = Buffer.from(seed, 'hex');
  // Type cast required because: HDWallet.fromSeed returns a union type, we know the seed is valid
  const { hdWallet } = HDWallet.fromSeed(seedBuffer) as { type: 'seedOk'; hdWallet: HDWallet };
  const derivationResult = hdWallet.selectAccount(0).selectRole(Roles.NightExternal).deriveKeyAt(0);
  if (derivationResult.type === 'keyOutOfBounds') throw new Error('Key derivation out of bounds');
  return derivationResult.key;
};

const getDustSeed = (seed: string): Uint8Array => {
  const seedBuffer = Buffer.from(seed, 'hex');
  // Type cast required because: HDWallet.fromSeed returns a union type, we know the seed is valid
  const { hdWallet } = HDWallet.fromSeed(seedBuffer) as { type: 'seedOk'; hdWallet: HDWallet };
  const derivationResult = hdWallet.selectAccount(0).selectRole(Roles.Dust).deriveKeyAt(0);
  if (derivationResult.type === 'keyOutOfBounds') throw new Error('Key derivation out of bounds');
  return derivationResult.key;
};

type WalletKeys = {
  shieldedKeys: ledger.ZswapSecretKeys;
  dustKey: ledger.DustSecretKey;
  unshieldedKeystore: ReturnType<typeof createKeystore>;
  unshieldedSeed: Uint8Array;
  signatureVerifyingKey: ledger.SignatureVerifyingKey;
  userAddress: ledger.UserAddress;
};

const deriveWalletKeys = (hexSeed: string, networkId: NetworkId.NetworkId): WalletKeys => {
  const shieldedSeed = getShieldedSeed(hexSeed);
  const dustSeed = getDustSeed(hexSeed);
  const unshieldedSeed = getUnshieldedSeed(hexSeed);

  const shieldedKeys = ledger.ZswapSecretKeys.fromSeed(shieldedSeed);
  const dustKey = ledger.DustSecretKey.fromSeed(dustSeed);
  const unshieldedKeystore = createKeystore(unshieldedSeed, networkId);
  const signatureVerifyingKey = ledger.signatureVerifyingKey(Buffer.from(unshieldedSeed).toString('hex'));
  const userAddress = ledger.addressFromKey(signatureVerifyingKey);

  return { shieldedKeys, dustKey, unshieldedKeystore, unshieldedSeed, signatureVerifyingKey, userAddress };
};

// =============================================================================
// Simulator Services (adapted from facade test helpers)
// =============================================================================

type SimulatorConfig = {
  simulator: Simulator;
  networkId: NetworkId.NetworkId;
  costParameters: { feeBlocksMargin: number };
};

const simulatorClock = (simulator: Simulator): Clock => ({
  now: () => Effect.runSync(simulator.query((s) => s.currentTime)),
});

const createSimulatorProvingService = (): ProvingService<UnboundTransaction> => {
  const effectService = makeSimulatorProvingServiceEffect();
  return {
    // The simulator's proving service erases proofs, so it returns Promise<ProofErasedTransaction>. The facade's
    // ProvingService is parameterised over UnboundTransaction. The two share enough runtime structure for downstream
    // signing/finalisation to work, so we coerce through `unknown` — explicit and narrow.
    prove: (tx: ledger.UnprovenTransaction): Promise<UnboundTransaction> =>
      effectService.prove(tx).pipe(Effect.runPromise) as unknown as Promise<UnboundTransaction>,
  };
};

const createSimulatorSubmissionService = (
  simulator: Simulator,
  txHistoryStorage: InMemoryTransactionHistoryStorage<WalletEntry>,
): SubmissionService<ledger.FinalizedTransaction> => {
  // `Simulator.submitTransaction` is typed `(tx: ProofErasedTransaction) => …`, but the generic
  // `SubmissionService<FinalizedTransaction>` wiring upstream hands us `Transaction<S, Proof, Binding>` values
  // (`FinalizedTransaction`). At runtime the simulator-backed facade only ever produces transactions whose proofs and
  // bindings were erased by `createSimulatorProvingService` above — so the value really is a `ProofErasedTransaction`,
  // and the simulator's wellFormed/apply paths don't read fields that distinguish the two. TypeScript can't express
  // "the same `Transaction` instance with different phantom type parameters", so we coerce through `unknown`.
  const adaptedSimulator = {
    submitTransaction: (tx: ledger.FinalizedTransaction): Effect.Effect<void, Error> =>
      simulator.submitTransaction(tx as unknown as ledger.ProofErasedTransaction).pipe(Effect.asVoid),
    getLatestState: () => simulator.getLatestState(),
  };
  const effectService = Submission.makeSimulatorSubmissionService<ledger.FinalizedTransaction>('InBlock')({
    simulator: adaptedSimulator,
  });

  // The simulator-backed sync capabilities don't write to txHistoryStorage on update (only the indexer-backed default
  // sync does — see unshielded-wallet/src/v1/Sync.ts:135). To make history queries work end-to-end in the simulator
  // setup, we upsert a minimal WalletEntry here after each successful submission. The entry uses the tx's last
  // identifier as the hash (matching what `facade.submitTransaction` returns).
  const upsertHistoryEntry = async (tx: ledger.FinalizedTransaction): Promise<void> => {
    const identifiers = tx.identifiers();
    if (identifiers.length === 0) return;
    // The connector view's `getHistory` (see createTransactionHistoryView below) returns `entry.hash` as the txHash.
    // The spec says txHash must be a 64-char hex string. `tx.identifiers().at(-1)` is the segment identifier (also hex
    // but not necessarily 64 chars); the actual tx hash comes from serializing the tx and hashing it. The simulator
    // doesn't expose tx hashes directly, so we compute one here that matches the spec's format.
    const txHash = createHash('sha256').update(Buffer.from(tx.serialize())).digest('hex');
    const entry: WalletEntry = {
      hash: txHash,
      protocolVersion: 0,
      status: 'SUCCESS' as const,
      identifiers,
      timestamp: new Date(),
    };
    await txHistoryStorage.upsert(entry);
  };

  const submitWithHistory = async (
    transaction: ledger.FinalizedTransaction,
    waitForStatus: SubmissionEvent['_tag'] = 'InBlock',
  ): Promise<SubmissionEvent> => {
    const result = await effectService.submitTransaction(transaction, waitForStatus).pipe(Effect.runPromise);
    await upsertHistoryEntry(transaction);
    return result;
  };

  return {
    submitTransaction: submitWithHistory as SubmitTransactionMethod<ledger.FinalizedTransaction>,
    close: () => effectService.close().pipe(Effect.runPromise),
  };
};

type SimulatorWalletFactories = {
  createShieldedWallet: (keys: ledger.ZswapSecretKeys) => ShieldedWalletAPI;
  createDustWallet: (key: ledger.DustSecretKey, params: ledger.DustParameters) => DustWalletAPI;
  createUnshieldedWallet: (keystore: ReturnType<typeof createKeystore>) => UnshieldedWalletAPI;
};

// Per-wallet history storage: a single instance shared across shielded/unshielded/dust sub-wallets and the facade, so
// all three writers update the same store and the facade reads back everything. This mirrors the canonical wiring used
// in wallet-integration-tests/e2e-tests (see walletInit.ts:134 — "Single shared tx-history storage so all three
// sub-wallets and the facade read/write the same instance").
const createSimulatorWalletFactories = (
  config: SimulatorConfig,
  txHistoryStorage: InMemoryTransactionHistoryStorage<WalletEntry>,
): SimulatorWalletFactories => {
  const ShieldedWalletFactory = CustomShieldedWallet(
    {
      ...config,
      txHistoryStorage,
      indexerClientConnection: { indexerHttpUrl: 'http://unused:0' },
    },
    new ShieldedV1Builder()
      .withDefaultTransactionType()
      .withSync(ShieldedSync.makeSimulatorSyncService, ShieldedSync.makeSimulatorSyncCapability)
      .withSerializationDefaults()
      .withTransactingDefaults()
      .withCoinsAndBalancesDefaults()
      .withTransactionHistory(ShieldedTransactionHistory.makeSimulatorTransactionHistoryService)
      .withKeysDefaults()
      .withCoinSelectionDefaults(),
  );

  const DustWalletFactory = CustomDustWallet(
    {
      ...config,
      txHistoryStorage,
      indexerClientConnection: { indexerHttpUrl: 'http://unused:0' },
    },
    new DustV1Builder()
      .withDefaultTransactionType()
      .withSync(DustSyncService.makeSimulatorSyncService, DustSyncService.makeSimulatorSyncCapability)
      .withSerializationDefaults()
      .withTransactingDefaults()
      .withCoinsAndBalancesDefaults()
      .withTransactionHistory(DustTransactionHistory.makeSimulatorTransactionHistoryService)
      .withKeysDefaults()
      .withCoinSelectionDefaults(),
  );

  const UnshieldedWalletFactory = CustomUnshieldedWallet(
    { ...config, txHistoryStorage },
    new UnshieldedV1Builder()
      .withSync(UnshieldedSync.makeSimulatorSyncService, UnshieldedSync.makeSimulatorSyncCapability)
      .withSerializationDefaults()
      .withTransactingDefaults()
      .withCoinsAndBalancesDefaults()
      .withKeysDefaults()
      .withCoinSelectionDefaults()
      .withTransactionHistoryDefaults(),
  );

  return {
    createShieldedWallet: (keys) => ShieldedWalletFactory.startWithSecretKeys(keys),
    createDustWallet: (key, params) => DustWalletFactory.startWithSecretKey(key, params),
    createUnshieldedWallet: (keystore) => UnshieldedWalletFactory.startWithPublicKey(PublicKey.fromKeyStore(keystore)),
  };
};

const makeSimulatorFacade = (
  config: SimulatorConfig,
  keys: WalletKeys,
): Effect.Effect<WalletFacade, never, Scope.Scope> => {
  const dustParameters = ledger.LedgerParameters.initialParameters().dust;
  const provingService = createSimulatorProvingService();
  const txHistoryStorage = new InMemoryTransactionHistoryStorage(WalletEntrySchema, mergeWalletEntries);
  const submissionService = createSimulatorSubmissionService(config.simulator, txHistoryStorage);
  const factories = createSimulatorWalletFactories(config, txHistoryStorage);

  return Effect.acquireRelease(
    Effect.promise(async () => {
      const facade = await WalletFacade.init({
        configuration: {
          ...config,
          indexerClientConnection: { indexerHttpUrl: 'http://unused' },
          relayURL: new URL('ws://unused'),
          txHistoryStorage,
        },
        shielded: () => factories.createShieldedWallet(keys.shieldedKeys),
        unshielded: () => factories.createUnshieldedWallet(keys.unshieldedKeystore),
        dust: () => factories.createDustWallet(keys.dustKey, dustParameters),
        provingService: () => provingService,
        submissionService: () => submissionService,
        clock: () => simulatorClock(config.simulator),
      });

      await facade.start(keys.shieldedKeys, keys.dustKey);
      return facade;
    }),
    (facade) => Effect.promise(() => facade.stop()),
  );
};

const waitForShieldedCoins = (facade: WalletFacade): Effect.Effect<void> =>
  Effect.promise(() =>
    rx.firstValueFrom(facade.state().pipe(rx.filter((s) => s.shielded.availableCoins.length > 0))),
  ).pipe(Effect.asVoid);

const waitForUnshieldedBalance = (facade: WalletFacade, tokenType: string, minBalance: bigint): Effect.Effect<bigint> =>
  Effect.promise(() =>
    rx.firstValueFrom(
      facade.state().pipe(
        rx.map((s) => s.unshielded.balances[tokenType] ?? 0n),
        rx.filter((balance) => balance >= minBalance),
      ),
    ),
  );

const waitForDustAvailable = (facade: WalletFacade): Effect.Effect<void> =>
  Effect.promise(() => rx.firstValueFrom(facade.state().pipe(rx.filter((s) => s.dust.availableCoins.length > 0)))).pipe(
    Effect.asVoid,
  );

// =============================================================================
// WalletKeystore backed by real HD keys
// =============================================================================

class SimulatorWalletKeystore implements WalletKeystore {
  readonly #keys: WalletKeys;

  constructor(keys: WalletKeys) {
    this.#keys = keys;
  }

  getShieldedSecretKeys(): ledger.ZswapSecretKeys {
    return this.#keys.shieldedKeys;
  }

  getDustSecretKey(): ledger.DustSecretKey {
    return this.#keys.dustKey;
  }

  getUnshieldedSecretKey(): string {
    return Buffer.from(this.#keys.unshieldedSeed).toString('hex');
  }

  signData(data: Uint8Array): ledger.Signature {
    return ledger.signData(this.getUnshieldedSecretKey(), data);
  }
}

// =============================================================================
// Simulator Environment
// =============================================================================

const NETWORK_ID = NetworkId.NetworkId.Undeployed;
const WALLET_SEED = '0000000000000000000000000000000000000000000000000000000000000001';
const TOKEN_VALUE_MULTIPLIER = 10n ** 6n;
const tokenValue = (value: bigint): bigint => value * TOKEN_VALUE_MULTIPLIER;

export interface SimulatorEnv {
  readonly simulator: Simulator;
  readonly facade: WalletFacade;
  readonly keys: WalletKeys;
  readonly keystore: WalletKeystore;
  readonly networkId: typeof NETWORK_ID;
  readonly shieldedTokenType: string;
  readonly alternateTokenType: string;
  readonly nightTokenType: string;
  readonly cleanup: () => Promise<void>;
}

/**
 * Initialize a complete simulator environment with a funded wallet.
 *
 * Creates a Simulator with genesis mints for two shielded token types plus Night, registers Night for Dust generation,
 * and fast-forwards time to accumulate Dust.
 */
export const initSimulatorEnv = async (): Promise<SimulatorEnv> => {
  const keys = deriveWalletKeys(WALLET_SEED, NETWORK_ID);
  const shieldedTokenType = SHIELDED_TOKEN_TYPE;
  const alternateTokenType = ALTERNATE_TOKEN_TYPE;
  const nightTokenType = NIGHT_TOKEN_TYPE;

  const genesisMints: [GenesisMint, ...GenesisMint[]] = [
    { type: 'shielded', tokenType: shieldedTokenType, amount: tokenValue(1_000_000n), recipient: keys.shieldedKeys },
    { type: 'shielded', tokenType: alternateTokenType, amount: tokenValue(1_000_000n), recipient: keys.shieldedKeys },
    {
      type: 'unshielded',
      tokenType: nightTokenType,
      amount: tokenValue(100_000n),
      recipient: keys.userAddress,
      verifyingKey: keys.signatureVerifyingKey,
    },
  ];

  const scope = Effect.runSync(Scope.make());

  const { simulator, facade } = await Effect.gen(function* () {
    const sim = yield* Simulator.init({ genesisMints, blockProducer: immediateBlockProducer() });

    const simulatorConfig: SimulatorConfig = {
      simulator: sim,
      networkId: NETWORK_ID,
      costParameters: { feeBlocksMargin: 5 },
    };
    const fcd = yield* makeSimulatorFacade(simulatorConfig, keys);

    // Wait for wallet to sync genesis funds
    yield* waitForShieldedCoins(fcd);
    yield* waitForUnshieldedBalance(fcd, nightTokenType, 1n);

    // Fast-forward time so Night UTXOs accumulate Dust potential
    yield* sim.fastForward(10_000n);

    // Register Night UTXOs for Dust generation
    const senderState: FacadeState = yield* Effect.promise(() =>
      rx.firstValueFrom(fcd.state().pipe(rx.filter((s) => s.unshielded.availableCoins.length > 0))),
    );

    const nightUtxos = senderState.unshielded.availableCoins.filter(
      (coin) => coin.utxo.type === nightTokenType && coin.meta.registeredForDustGeneration === false,
    );

    if (nightUtxos.length > 0) {
      const dustRegistrationRecipe = yield* Effect.promise(() =>
        fcd.registerNightUtxosForDustGeneration(nightUtxos, keys.signatureVerifyingKey, (payload) =>
          keys.unshieldedKeystore.signData(payload),
        ),
      );
      const registrationTx = yield* Effect.promise(() => fcd.finalizeRecipe(dustRegistrationRecipe));
      yield* Effect.promise(() => fcd.submitTransaction(registrationTx));

      // Wait for Dust to be available
      yield* waitForDustAvailable(fcd);
    }

    return { simulator: sim, facade: fcd };
  }).pipe(Effect.provideService(Scope.Scope, scope), Effect.runPromise);

  const keystore = new SimulatorWalletKeystore(keys);

  return {
    simulator,
    facade,
    keys,
    keystore,
    networkId: NETWORK_ID,
    shieldedTokenType,
    alternateTokenType,
    nightTokenType,
    cleanup: () => Scope.close(scope, Exit.void).pipe(Effect.runPromise),
  };
};

// =============================================================================
// Transaction History adapter (WalletFacade.getAllFromTxHistory → connector view)
// =============================================================================

const mapWalletEntryStatus = (status: 'SUCCESS' | 'FAILURE' | 'PARTIAL_SUCCESS'): TxStatus => ({
  status: 'finalized',
  executionStatus: { 0: status === 'FAILURE' ? 'Failure' : 'Success' },
});

const createTransactionHistoryView = (facade: WalletFacade): TransactionHistoryServiceView => ({
  getHistory: async (pageNumber: number, pageSize: number): Promise<PaginatedHistoryResult> => {
    const allEntries = await facade.getAllFromTxHistory();
    const start = pageNumber * pageSize;
    const page = allEntries.slice(start, start + pageSize);
    const entries: readonly TransactionHistoryEntryView[] = page.map((entry) => ({
      txHash: entry.hash,
      txStatus: mapWalletEntryStatus(entry.status),
    }));
    return { entries, totalCount: allEntries.length };
  },
});

// Adapt the full WalletFacade to the narrower WalletFacadeView the connector consumes.
//
// Two differences need bridging:
//
// 1. WalletFacade.submitTransaction returns Promise<TransactionIdentifier>; WalletFacadeView.submitTransaction returns
//    Promise<void>. We discard the identifier — the connector never reads it.
// 2. WalletFacade has no `transactionHistory` field; the connector reads `transactionHistory` for getTransactions. We
//    plug in our simulator-backed view.
//
// All other fields/methods (shielded, unshielded, dust, transferTransaction, initSwap, signRecipe, finalizeRecipe,
// balanceUnboundTransaction, balanceFinalizedTransaction) are structurally compatible — we forward them via bound
// references. Building this object explicitly (rather than casting through `unknown`) keeps the view's contract
// type-checked at every property.
const facadeAsView = (facade: WalletFacade): WalletFacadeView => ({
  shielded: facade.shielded,
  unshielded: facade.unshielded,
  dust: facade.dust,
  clock: facade.clock,
  transactionHistory: createTransactionHistoryView(facade),
  transferTransaction: (outputs, secretKeys, options) => facade.transferTransaction(outputs, secretKeys, options),
  initSwap: (desiredInputs, desiredOutputs, secretKeys, options) =>
    facade.initSwap(desiredInputs, desiredOutputs, secretKeys, options),
  signRecipe: (recipe, signSegment) => facade.signRecipe(recipe, signSegment),
  finalizeRecipe: (recipe) => facade.finalizeRecipe(recipe),
  balanceUnboundTransaction: (tx, secretKeys, options) => facade.balanceUnboundTransaction(tx, secretKeys, options),
  balanceFinalizedTransaction: (tx, secretKeys, options) => facade.balanceFinalizedTransaction(tx, secretKeys, options),
  // Discard the returned TransactionIdentifier — the connector consumes a void-returning submit.
  submitTransaction: async (tx) => {
    await facade.submitTransaction(tx);
  },
});

// =============================================================================
// Multi-wallet setup (controllable per-wallet funding)
// =============================================================================

/** Deterministic 32-byte hex seed derived from a wallet name. Stable across runs. */
const walletSeedFromName = (name: string): string => createHash('sha256').update(`wallet:${name}`).digest('hex');

const deriveShieldedAddressString = (keys: WalletKeys, networkId: string): string => {
  const coinPublicKey = new ShieldedCoinPublicKey(Buffer.from(keys.shieldedKeys.coinPublicKey, 'hex'));
  const encryptionPublicKey = new ShieldedEncryptionPublicKey(
    Buffer.from(keys.shieldedKeys.encryptionPublicKey, 'hex'),
  );
  return MidnightBech32m.encode(networkId, new ShieldedAddress(coinPublicKey, encryptionPublicKey)).asString();
};

const deriveUnshieldedAddressString = (keys: WalletKeys, networkId: string): string => {
  return MidnightBech32m.encode(
    networkId,
    new UnshieldedAddress(Buffer.from(keys.signatureVerifyingKey, 'hex')),
  ).asString();
};

/**
 * Create a fresh simulator with the requested wallets pre-funded. Each wallet has its own HD keys derived
 * deterministically from its name, its own facade against the shared simulator, and a connected API.
 *
 * Wallets funded with Night get their UTXOs registered for Dust generation and time advanced 10k blocks so Dust
 * accumulates before the function resolves. Wallets without Night will have zero Dust (use them for payFees=false
 * scenarios).
 */
const setupSimulatorWallets = async <K extends string>(
  spec: Readonly<Record<K, WalletInitSpec>>,
): Promise<MultiWalletSetup<K>> => {
  const names = Object.keys(spec) as K[];
  if (names.length === 0) throw new Error('setupWallets: spec must contain at least one wallet');

  const walletsKeys = new Map<K, WalletKeys>(
    names.map((name) => [name, deriveWalletKeys(walletSeedFromName(name), NETWORK_ID)]),
  );

  // Amounts in the spec are in "tokens" (whole units); the simulator's underlying mints take raw subunits with
  // 6 decimals, matching how the rest of the SDK's simulator tests use the value. Each scalar entry mints a single
  // UTXO; an array of bigints mints one UTXO per entry.
  const normalizeAmounts = (v: bigint | readonly bigint[] | undefined): bigint[] =>
    v === undefined ? [] : Array.isArray(v) ? (v as bigint[]) : [v as bigint];

  const mints: GenesisMint[] = names.flatMap((name) => {
    const keys = walletsKeys.get(name)!;
    const initSpec = spec[name];
    const shielded: GenesisMint[] = Object.entries(initSpec.shielded ?? {}).flatMap(([tokenType, amounts]) =>
      normalizeAmounts(amounts)
        .filter((a) => a > 0n)
        .map((amount) => ({
          type: 'shielded' as const,
          tokenType,
          amount: tokenValue(amount),
          recipient: keys.shieldedKeys,
        })),
    );
    const unshielded: GenesisMint[] = Object.entries(initSpec.unshielded ?? {}).flatMap(([tokenType, amounts]) =>
      normalizeAmounts(amounts)
        .filter((a) => a > 0n)
        .map((amount) => ({
          type: 'unshielded' as const,
          tokenType,
          amount: tokenValue(amount),
          recipient: keys.userAddress,
          verifyingKey: keys.signatureVerifyingKey,
        })),
    );
    return [...shielded, ...unshielded];
  });

  if (mints.length === 0) {
    throw new Error(
      'setupWallets: at least one wallet must have non-zero funding (Simulator requires non-empty mints)',
    );
  }

  const genesisMints = mints as [GenesisMint, ...GenesisMint[]];

  const scope = Effect.runSync(Scope.make());

  // Pure predicates over the spec — computed once, then used as gates for the side-effecting phases below.
  const anyAmountPositive = (v: bigint | readonly bigint[] | undefined): boolean =>
    v === undefined ? false : Array.isArray(v) ? (v as bigint[]).some((x) => x > 0n) : (v as bigint) > 0n;
  const hasShielded = (name: K): boolean => Object.values(spec[name].shielded ?? {}).some(anyAmountPositive);
  const hasNight = (name: K): boolean => anyAmountPositive(spec[name].unshielded?.[NIGHT_TOKEN_TYPE]);
  const anyNight = names.some(hasNight);

  const facadesByName = await Effect.gen(function* () {
    const sim = yield* Simulator.init({ genesisMints, blockProducer: immediateBlockProducer() });
    const simulatorConfig: SimulatorConfig = {
      simulator: sim,
      networkId: NETWORK_ID,
      costParameters: { feeBlocksMargin: 5 },
    };

    const facadePairs = yield* Effect.forEach(names, (name) =>
      Effect.map(makeSimulatorFacade(simulatorConfig, walletsKeys.get(name)!), (fcd): [K, WalletFacade] => [name, fcd]),
    );
    const built = new Map<K, WalletFacade>(facadePairs);

    // Per-wallet sync wait, then (if any wallet received Night) Night→Dust registration.
    // We fast-forward once at the end (not per wallet) so each block-advance is shared.
    yield* Effect.forEach(names, (name) => {
      const fcd = built.get(name)!;
      return Effect.gen(function* () {
        if (hasShielded(name)) yield* waitForShieldedCoins(fcd);
        if (hasNight(name)) yield* waitForUnshieldedBalance(fcd, NIGHT_TOKEN_TYPE, 1n);
      });
    });

    if (anyNight) {
      // Single fast-forward to accumulate Dust generation potential across all wallets that received Night.
      yield* sim.fastForward(10_000n);

      yield* Effect.forEach(names.filter(hasNight), (name) =>
        Effect.gen(function* () {
          const keys = walletsKeys.get(name)!;
          const fcd = built.get(name)!;

          const state: FacadeState = yield* Effect.promise(() =>
            rx.firstValueFrom(fcd.state().pipe(rx.filter((s) => s.unshielded.availableCoins.length > 0))),
          );
          const nightUtxos = state.unshielded.availableCoins.filter(
            (coin) => coin.utxo.type === NIGHT_TOKEN_TYPE && coin.meta.registeredForDustGeneration === false,
          );
          if (nightUtxos.length === 0) return;

          const recipe = yield* Effect.promise(() =>
            fcd.registerNightUtxosForDustGeneration(nightUtxos, keys.signatureVerifyingKey, (payload) =>
              keys.unshieldedKeystore.signData(payload),
            ),
          );
          const finalized = yield* Effect.promise(() => fcd.finalizeRecipe(recipe));
          yield* Effect.promise(() => fcd.submitTransaction(finalized));
          yield* waitForDustAvailable(fcd);
        }),
      );
    }

    return built;
  }).pipe(Effect.provideService(Scope.Scope, scope), Effect.runPromise);

  // Build per-wallet Connector + ConnectedAPI. Sequential (preserves original ordering and side-effect ordering).
  const entries: ReadonlyArray<[K, WalletInstance]> = await names.reduce<Promise<ReadonlyArray<[K, WalletInstance]>>>(
    async (accP, name) => {
      const acc = await accP;
      const keys = walletsKeys.get(name)!;
      const fcd = facadesByName.get(name)!;
      const facadeView = facadeAsView(fcd);
      const keystore: WalletKeystore = new SimulatorWalletKeystore(keys);
      const metadata = randomValue(defaultConnectorMetadataArbitrary);
      const connector = new Connector(metadata, facadeView, keystore, defaultConnectorConfig);
      const api = await connector.connect(NETWORK_ID_STRING);

      const shieldedAddress = deriveShieldedAddressString(keys, NETWORK_ID_STRING);
      const unshieldedAddress = deriveUnshieldedAddressString(keys, NETWORK_ID_STRING);
      const dustAddress = (await api.getDustAddress()).dustAddress;

      const entry: [K, WalletInstance] = [
        name,
        {
          api,
          disconnect: () => api.disconnect(),
          addresses: { shielded: shieldedAddress, unshielded: unshieldedAddress, dust: dustAddress },
        },
      ];
      return [...acc, entry];
    },
    Promise.resolve([] as ReadonlyArray<[K, WalletInstance]>),
  );

  const wallets = Object.fromEntries(entries) as Record<K, WalletInstance>;

  return {
    wallets,
    disconnect: async () => {
      await Promise.all(entries.map(([, w]) => w.disconnect()));
      await Scope.close(scope, Exit.void).pipe(Effect.runPromise);
    },
    tokenTypes: {
      shielded: SHIELDED_TOKEN_TYPE,
      alternate: ALTERNATE_TOKEN_TYPE,
      night: NIGHT_TOKEN_TYPE,
    },
  };
};

// =============================================================================
// Test Context Factory
// =============================================================================

const mockProvingProviderFactory = createMockProvingProviderFactory(
  () => Promise.resolve([]),
  () => Promise.resolve(new Uint8Array([0x00, 0x01, 0x02, 0x03])),
);

// Pre-computed constants (don't depend on simulator instance)
const SHIELDED_TOKEN_TYPE = ledger.shieldedToken().raw;
const ALTERNATE_TOKEN_TYPE = ledger.sampleRawTokenType();
const NIGHT_TOKEN_TYPE = ledger.nativeToken().raw;
const NETWORK_ID_STRING: string = NETWORK_ID;

const defaultConnectorConfig: ConnectorConfiguration = {
  networkId: NETWORK_ID_STRING,
  indexerUri: 'http://unused:0',
  indexerWsUri: 'ws://unused:0',
  substrateNodeUri: 'ws://unused:0',
  provingProviderFactory: mockProvingProviderFactory,
};

const staticEnvironment: TestEnvironment = {
  networkId: NETWORK_ID_STRING,

  addresses: {
    shielded: MidnightBech32m.encode(NETWORK_ID_STRING, testShieldedWithKeys.address).asString(),
    shielded2: MidnightBech32m.encode(NETWORK_ID_STRING, testShieldedWithKeys2.address).asString(),
    unshielded: MidnightBech32m.encode(NETWORK_ID_STRING, testUnshieldedWithKeys.address).asString(),
    unshielded2: MidnightBech32m.encode(NETWORK_ID_STRING, testUnshieldedWithKeys2.address).asString(),
  },

  addressKeys: {
    shielded: testShieldedWithKeys,
    shielded2: testShieldedWithKeys2,
    unshielded: testUnshieldedWithKeys,
    unshielded2: testUnshieldedWithKeys2,
  },

  tokenTypes: {
    standard: SHIELDED_TOKEN_TYPE,
    alternate: ALTERNATE_TOKEN_TYPE,
    night: NIGHT_TOKEN_TYPE,
  },

  // buildSealedTransaction/serializeTransaction intentionally omitted:
  // the simulator's connector tests don't yet emit mock sealed transactions; tests that need them skip when these
  // are undefined.
};

/**
 * Create a DappConnectorTestContext backed by the simulator environment.
 *
 * Accepts a lazy getter for the SimulatorEnv so the context can be created during describe() registration (synchronous)
 * while the actual env is initialized later in beforeAll (asynchronous). The env is only accessed inside
 * createConnector/createConnectedAPI which run during it() blocks.
 */
export const createSimulatorContext = (getEnv: () => SimulatorEnv): DappConnectorTestContext => {
  const context: DappConnectorTestContext = {
    implementationName: 'reference',
    environment: staticEnvironment,
    installTarget: {},

    createConnector: () => {
      const env = getEnv();
      const facade = facadeAsView(env.facade);
      const metadata = randomValue(defaultConnectorMetadataArbitrary);
      return new Connector(metadata, facade, env.keystore, defaultConnectorConfig);
    },

    createConnectedAPI: async (options?: CreateConnectedAPIOptions): Promise<ConnectedAPIInstance> => {
      const env = getEnv();
      const facade = facadeAsView(env.facade);
      const networkId = options?.networkId ?? defaultConnectorConfig.networkId;
      const connConfig: ConnectorConfiguration = { ...defaultConnectorConfig, networkId };
      const metadata = randomValue(defaultConnectorMetadataArbitrary);
      const connector = new Connector(metadata, facade, env.keystore, connConfig);
      const api = await connector.connect(networkId);

      return {
        api,
        disconnect: () => api.disconnect(),
        networkId,
      };
    },

    setupWallets: setupSimulatorWallets,
  };

  return context;
};
