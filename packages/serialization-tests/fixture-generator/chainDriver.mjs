// Drives a train's own ledger through a deterministic on-chain scenario, collecting the emitted
// ledger events so wallet states can be produced by EVENT REPLAY — the same sync path a production
// wallet uses. Fixture states therefore hold real merkle trees, real dust generation state, and
// spends applied/removed by the ledger, not hand-assembled approximations.
//
// Scenario blocks:
//   B1  mint: 3 coins of TOKEN_A + 1 coin of TOKEN_B to the shielded sender, plus a custom
//       unshielded token to the night address (relaxed-strictness genesis-style tx)
//   B2  dust registration for the night key (registered BEFORE night arrives — required for the
//       ledger to emit DustInitialUtxo on the claim)
//   B3  night claim via testingDistributeNight + ClaimRewardsTransaction (night cannot be minted:
//       total-supply invariant holds even under relaxed strictness)
//   B4  shielded transfer sender→receiver: real input + recipient output + change output
//   deep option: extra blocks of interleaved mints and transfers to grow a non-trivial
//   commitment/merkle tree with gaps (spent-and-removed coins)
//
// The wasm Event objects are CONSUMED by replayEvents (ownership moves into Rust), so events are
// stored serialized; every consumer deserializes fresh copies via `eventsOf`.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const fill = (b) => new Uint8Array(32).fill(b);

export const SEEDS = {
  shieldedSender: fill(7),
  shieldedReceiver: fill(8),
  dust: fill(9),
  nightBip340: fill(21),
};

export const TOKEN_A = '11'.repeat(32);
export const TOKEN_B = '22'.repeat(32);
export const CUSTOM_UNSHIELDED = '33'.repeat(32);
export const MINT_A_VALUES = [100n, 250n, 400n];
export const MINT_B_VALUE = 5000n;
export const TRANSFER_VALUE = 120n;
export const NIGHT_VALUE = 1_000_000n;
export const CUSTOM_UNSHIELDED_VALUE = 777n;
export const GENESIS_TIME = new Date('2026-02-01T00:00:00.000Z');
export const BLOCK_SECONDS = 6;
export const DEEP_ROUNDS = 12;

export const ledgerFor = async (alias) => {
  const pkgJson = JSON.parse(readFileSync(path.join(HERE, 'node_modules', alias, 'package.json'), 'utf8'));
  const ledgerName = Object.keys(pkgJson.dependencies ?? {}).find((d) => d.includes('ledger'));
  const resolved = createRequire(path.join(HERE, 'node_modules', alias, 'dist', 'index.js')).resolve(ledgerName);
  return import(pathToFileURL(resolved));
};

const relaxedStrictness = (L) => {
  const s = new L.WellFormedStrictness();
  s.enforceLimits = false;
  s.enforceBalancing = false;
  s.verifySignatures = false;
  s.verifyNativeProofs = false;
  s.verifyContractProofs = false;
  return s;
};

/** Run the deterministic scenario against one train's ledger module. */
export const runScenario = (L, { networkId = 'undeployed', deep = false } = {}) => {
  const senderKeys = L.ZswapSecretKeys.fromSeed(SEEDS.shieldedSender);
  const receiverKeys = L.ZswapSecretKeys.fromSeed(SEEDS.shieldedReceiver);
  const dustKey = L.DustSecretKey.fromSeed(SEEDS.dust);
  const nightSigning = L.signingKeyFromBip340(SEEDS.nightBip340);
  const nightVk = L.signatureVerifyingKey(nightSigning);
  const nightAddress = L.addressFromKey(nightVk);

  const strictness = relaxedStrictness(L);
  let ledgerState = L.LedgerState.blank(networkId);
  let time = GENESIS_TIME;
  let parentHash = '00'.repeat(32);
  const blocks = [];

  const eventsOf = (eventBytes) => eventBytes.map((b) => L.Event.deserialize(b));

  const applyBlock = (label, txs) => {
    time = new Date(time.getTime() + BLOCK_SECONDS * 1000);
    // ledger 8.0.x requires lastBlockTime in BlockContext; other versions tolerate the extra field
    const blockContext = {
      secondsSinceEpoch: BigInt(Math.floor(time.getTime() / 1000)),
      secondsSinceEpochErr: 10,
      parentBlockHash: parentHash,
      lastBlockTime: BigInt(Math.floor(time.getTime() / 1000) - BLOCK_SECONDS),
    };
    const eventBytes = txs.flatMap((tx) => {
      const verified = tx.wellFormed(ledgerState, strictness, time);
      const context = new L.TransactionContext(ledgerState, blockContext);
      const [nextState, result] = ledgerState.apply(verified, context);
      if (result.type !== 'success') {
        throw new Error(`${label}: transaction did not succeed: ${result.type} ${result.error ?? ''}`);
      }
      ledgerState = nextState;
      return result.events.map((e) => e.serialize());
    });
    ledgerState = ledgerState.postBlockUpdate(time);
    parentHash = '11'.repeat(31) + String(blocks.length + 1).padStart(2, '0');
    blocks.push({ label, eventBytes });
    return eventBytes;
  };

  const mkOutputOffer = (keys, tokenType, value) => {
    const coin = L.createShieldedCoinInfo(tokenType, value);
    const output = L.ZswapOutput.new(coin, 0, keys.coinPublicKey, keys.encryptionPublicKey);
    return L.ZswapOffer.fromOutput(output, tokenType, value);
  };
  const mergeOffers = (offers) => offers.reduce((merged, o) => (merged === undefined ? o : merged.merge(o)), undefined);

  // --- B1: genesis-style mint -------------------------------------------------------------------
  const mintOffer = mergeOffers([
    ...MINT_A_VALUES.map((v) => mkOutputOffer(senderKeys, TOKEN_A, v)),
    mkOutputOffer(senderKeys, TOKEN_B, MINT_B_VALUE),
  ]);
  const mintIntent = L.Intent.new(new Date(time.getTime() + 3600_000));
  mintIntent.guaranteedUnshieldedOffer = L.UnshieldedOffer.new(
    [],
    [{ type: CUSTOM_UNSHIELDED, value: CUSTOM_UNSHIELDED_VALUE, owner: nightAddress }],
    [],
  );
  const mintEventBytes = applyBlock('mint', [
    L.Transaction.fromParts(networkId, mintOffer, undefined, mintIntent).eraseProofs(),
  ]);

  // --- B2: dust registration (before night arrives) ---------------------------------------------
  const registration = new L.DustRegistration('signature', nightVk, dustKey.publicKey, 0n);
  const dustIntent = L.Intent.new(new Date(time.getTime() + 3600_000));
  dustIntent.dustActions = new L.DustActions('signature', 'pre-proof', time, [], [registration]);
  const registrationEventBytes = applyBlock('dust-registration', [
    L.Transaction.fromParts(networkId, undefined, undefined, dustIntent).eraseProofs(),
  ]);

  // --- B3: night claim (triggers DustInitialUtxo for the registered key) -------------------------
  ledgerState = ledgerState.testingDistributeNight(nightAddress, NIGHT_VALUE, time);
  const claim = new L.ClaimRewardsTransaction(
    new L.SignatureErased().instance,
    networkId,
    NIGHT_VALUE,
    nightVk,
    '44'.repeat(32),
    new L.SignatureErased(),
  );
  const nightEventBytes = applyBlock('night-claim', [L.Transaction.fromRewards(claim).eraseProofs()]);

  // --- B4: shielded transfer sender → receiver ---------------------------------------------------
  const preTransferBytes = [...mintEventBytes, ...registrationEventBytes, ...nightEventBytes];
  const senderLocalAfterMint = new L.ZswapLocalState().replayEvents(senderKeys, eventsOf(preTransferBytes));
  const coinToSpend = [...senderLocalAfterMint.coins].find((c) => c.value === 250n && c.type === TOKEN_A);
  if (coinToSpend === undefined) throw new Error('mint replay did not surface the 250n coin');
  const [, input] = senderLocalAfterMint.spend(senderKeys, coinToSpend, 0);
  const transferOffer = mergeOffers([
    L.ZswapOffer.fromInput(input, TOKEN_A, 250n),
    mkOutputOffer(receiverKeys, TOKEN_A, TRANSFER_VALUE),
    mkOutputOffer(senderKeys, TOKEN_A, 250n - TRANSFER_VALUE),
  ]);
  const transferEventBytes = applyBlock('transfer', [L.Transaction.fromParts(networkId, transferOffer).eraseProofs()]);

  // --- deep option: grow the tree with interleaved mints and spends ------------------------------
  // Each round replays everything emitted so far to pick the next coin, so the rounds accumulate
  // into a local array. This is one of the documented exceptions to the no-mutation rule: the
  // loop is inherently sequential (round N's spend depends on round N-1's events).
  const deepAccumulator = [];
  const deepEventBytes = !deep
    ? []
    : Array.from({ length: DEEP_ROUNDS }, (_, round) => round).flatMap((round) => {
        const mintBytes = applyBlock(`deep-mint-${round}`, [
          L.Transaction.fromParts(
            networkId,
            mergeOffers([
              mkOutputOffer(senderKeys, TOKEN_A, BigInt(1000 + round)),
              mkOutputOffer(senderKeys, TOKEN_B, BigInt(2000 + round)),
              mkOutputOffer(receiverKeys, TOKEN_A, BigInt(3000 + round)),
            ]),
          ).eraseProofs(),
        ]);
        // Spend the oldest currently-unspent sender TOKEN_A coin back and forth to churn the tree.
        const soFar = [
          ...mintEventBytes,
          ...registrationEventBytes,
          ...nightEventBytes,
          ...transferEventBytes,
          ...deepAccumulator,
          ...mintBytes,
        ];
        const local = new L.ZswapLocalState().replayEvents(senderKeys, eventsOf(soFar));
        const spendable = [...local.coins]
          .filter((c) => c.type === TOKEN_A)
          .sort((a, b) => Number(a.mt_index - b.mt_index));
        const coin = spendable[0];
        const [, deepInput] = local.spend(senderKeys, coin, 0);
        const spendBytes = applyBlock(`deep-spend-${round}`, [
          L.Transaction.fromParts(
            networkId,
            mergeOffers([
              L.ZswapOffer.fromInput(deepInput, TOKEN_A, coin.value),
              mkOutputOffer(receiverKeys, TOKEN_A, coin.value),
            ]),
          ).eraseProofs(),
        ]);
        deepAccumulator.push(...mintBytes, ...spendBytes);
        return [...mintBytes, ...spendBytes];
      });

  const allEventBytes = [
    ...mintEventBytes,
    ...registrationEventBytes,
    ...nightEventBytes,
    ...transferEventBytes,
    ...deepEventBytes,
  ];

  return {
    networkId,
    senderKeys,
    receiverKeys,
    dustKey,
    nightVk,
    nightAddress,
    blocks,
    mintEventBytes,
    registrationEventBytes,
    nightEventBytes,
    transferEventBytes,
    deepEventBytes,
    allEventBytes,
    eventsOf,
    finalTime: time,
    ledgerState,
  };
};
