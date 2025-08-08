import * as zswap from '@midnight-ntwrk/zswap';
import { CoreWallet, NetworkId } from '@midnight-ntwrk/wallet';
import { Record, Array, pipe } from 'effect';
import * as fc from 'fast-check';
import { makeDefaultCoinsAndBalancesCapability, AvailableCoin, PendingCoin } from '../CoinsAndBalances';

const amountArbitrary = fc.bigInt({ min: 1n, max: 1000n });
const tokenTypeArbitrary = fc.constantFrom(zswap.nativeToken(), zswap.sampleTokenType());
const coinArbitrary = fc.record({
  value: amountArbitrary,
  tokenType: tokenTypeArbitrary,
});

const toAvailableCoin = (c: { value: bigint; tokenType: string }, secretKeys: zswap.SecretKeys): AvailableCoin => {
  const coin = zswap.createCoinInfo(c.tokenType, BigInt(c.value));
  return {
    coin: { ...coin, mt_index: 0n },
    commitment: zswap.coin_commitment(coin, secretKeys.coinPublicKey),
    nullifier: zswap.coin_nullifier(coin, secretKeys),
  };
};

const toPendingCoin = (c: { value: bigint; tokenType: string }, secretKeys: zswap.SecretKeys): PendingCoin => {
  const coin = zswap.createCoinInfo(c.tokenType, BigInt(c.value));
  return {
    coin,
    commitment: zswap.coin_commitment(coin, secretKeys.coinPublicKey),
    nullifier: zswap.coin_nullifier(coin, secretKeys),
  };
};

const createInitialState = (secretKeys: zswap.SecretKeys, coins: AvailableCoin[]): zswap.LocalState => {
  const finalOffer = pipe(
    coins,
    Array.map(({ coin }) =>
      zswap.UnprovenOffer.fromOutput(
        zswap.UnprovenOutput.new(coin, 0, secretKeys.coinPublicKey, secretKeys.encryptionPublicKey),
        coin.type,
        coin.value,
      ),
    ),
    Array.reduce(new zswap.UnprovenOffer(), (acc, offer) => acc.merge(offer)),
  );

  const tx = new zswap.UnprovenTransaction(finalOffer).eraseProofs();

  return tx.guaranteedCoins
    ? new zswap.LocalState().applyProofErased(secretKeys, tx.guaranteedCoins)
    : new zswap.LocalState();
};

const applyPendingCoinValues = (
  state: zswap.LocalState,
  secretKeys: zswap.SecretKeys,
  coins: PendingCoin[],
): zswap.LocalState =>
  pipe(
    coins,
    Array.reduce(state, (currentState, { coin }) => currentState.watchFor(secretKeys.coinPublicKey, coin)),
  );

const issueSpendingOfCoins = (
  state: zswap.LocalState,
  secretKeys: zswap.SecretKeys,
  coins: AvailableCoin[],
): zswap.LocalState =>
  pipe(
    coins,
    Array.reduce(state, (currentState, { coin }) => {
      const coinToSpend = [...currentState.coins].find(
        (c) => c.value === coin.value && c.type === coin.type && c.nonce === coin.nonce,
      );
      if (!coinToSpend) {
        throw new Error(`Could not find coin with value ${coin.value}n, type ${coin.type}, and nonce ${coin.nonce}`);
      }
      const [newLocalState, _] = currentState.spend(secretKeys, coinToSpend, 0);
      return newLocalState;
    }),
  );

function groupByTokenType<T extends AvailableCoin | PendingCoin>(coins: readonly T[]): Record<string, bigint[]> {
  return pipe(
    coins,
    Array.groupBy((c) => c.coin.type),
    Record.map((arr) => arr.map((c) => c.coin.value)),
    Record.map((arr) => arr.slice().sort((a, b) => Number(a - b))),
  );
}

describe('DefaultCoinsAndBalancesCapability', () => {
  it('should return correct balances and coins when wallet has no pending coins and no pending balances', () => {
    fc.assert(
      fc.property(fc.array(coinArbitrary), (coinInputs) => {
        const secretKeys = zswap.SecretKeys.fromSeed(new Uint8Array(32).fill(1));
        const setupAvailableCoins: AvailableCoin[] = coinInputs.map((c) => toAvailableCoin(c, secretKeys));
        const networkId = zswap.NetworkId.Undeployed;
        const capability = makeDefaultCoinsAndBalancesCapability();

        const localState = createInitialState(secretKeys, setupAvailableCoins);
        const state = CoreWallet.emptyV1(localState, secretKeys, NetworkId.fromJs(networkId));
        const pendingBalances = capability.getPendingBalances(state);
        const availableBalances = capability.getAvailableBalances(state);
        const totalBalances = capability.getTotalBalances(state);
        const pendingCoins = capability.getPendingCoins(state);
        const availableCoins = capability.getAvailableCoins(state);
        const totalCoins = capability.getTotalCoins(state);

        const availableCoinsbyType = groupByTokenType(availableCoins);
        Object.entries(availableCoinsbyType).forEach(([tokenType, values]) => {
          const sum = values.reduce((a, b) => a + b, 0n);
          expect(availableBalances[tokenType]).toEqual(sum);
          expect(totalBalances[tokenType]).toEqual(sum);
          expect(availableCoinsbyType[tokenType]).toEqual(values);
          expect(groupByTokenType(totalCoins)[tokenType]).toEqual(values);
        });

        expect(pendingBalances).toEqual({});
        expect(groupByTokenType(pendingCoins)).toEqual({});
      }),
      { numRuns: 10 },
    );
  });

  it('should return correct balances and coins when wallet has a pending coin and a pending balance', () => {
    fc.assert(
      fc.property(fc.array(coinArbitrary), fc.array(coinArbitrary), (fixtureAvailableCoins, fixturePendingCoins) => {
        const secretKeys = zswap.SecretKeys.fromSeed(new Uint8Array(32).fill(1));
        const setupAvailableCoins: AvailableCoin[] = fixtureAvailableCoins.map((c) => toAvailableCoin(c, secretKeys));
        const setupPendingCoins: PendingCoin[] = fixturePendingCoins.map((c) => toPendingCoin(c, secretKeys));
        const networkId = zswap.NetworkId.Undeployed;
        const capability = makeDefaultCoinsAndBalancesCapability();

        let localState = createInitialState(secretKeys, setupAvailableCoins);
        localState = applyPendingCoinValues(localState, secretKeys, setupPendingCoins);
        const state = CoreWallet.emptyV1(localState, secretKeys, NetworkId.fromJs(networkId));
        const availableBalances = capability.getAvailableBalances(state);
        const pendingBalances = capability.getPendingBalances(state);
        const totalBalances = capability.getTotalBalances(state);
        const availableCoins = capability.getAvailableCoins(state);
        const pendingCoins = capability.getPendingCoins(state);
        const totalCoins = capability.getTotalCoins(state);

        const byTypeAvailable = groupByTokenType(availableCoins);
        const byTypePending = groupByTokenType(pendingCoins);
        const byTypeTotal = groupByTokenType(totalCoins);

        const allTokenTypes: string[] = Object.keys(byTypeAvailable)
          .concat(Object.keys(byTypePending))
          .filter((value, index, self) => self.indexOf(value) === index);

        allTokenTypes.forEach((tokenType: string) => {
          const available = byTypeAvailable[tokenType] || [];
          const pending = byTypePending[tokenType] || [];
          const total = byTypeTotal[tokenType] || [];

          const availableSum = available.reduce((a, b) => a + b, 0n);
          const pendingSum = pending.reduce((a, b) => a + b, 0n);
          const totalSum = availableSum + pendingSum;

          expect(availableBalances[tokenType] ?? 0n).toEqual(availableSum);
          expect(pendingBalances[tokenType] ?? 0n).toEqual(pendingSum);
          expect(totalBalances[tokenType] ?? 0n).toEqual(totalSum);

          const expectedAvailable = fixtureAvailableCoins.filter((c) => c.tokenType === tokenType).map((c) => c.value);
          const expectedPending = fixturePendingCoins.filter((c) => c.tokenType === tokenType).map((c) => c.value);
          const expectedTotal = expectedAvailable.concat(expectedPending);

          const bigintCompare = (a: bigint, b: bigint) => (a < b ? -1 : a > b ? 1 : 0);
          const sortedAvailable = pipe(available, Array.sort(bigintCompare));
          const sortedExpectedAvailable = pipe(expectedAvailable, Array.sort(bigintCompare));
          const sortedPending = pipe(pending, Array.sort(bigintCompare));
          const sortedExpectedPending = pipe(expectedPending, Array.sort(bigintCompare));
          const sortedTotal = pipe(total, Array.sort(bigintCompare));
          const sortedExpectedTotal = pipe(expectedTotal, Array.sort(bigintCompare));

          expect(sortedAvailable).toEqual(sortedExpectedAvailable);
          expect(sortedPending).toEqual(sortedExpectedPending);
          expect(sortedTotal).toEqual(sortedExpectedTotal);
        });
      }),
      { numRuns: 10 },
    );
  });

  it('should return correct balances and coins when wallet has a pending spend', () => {
    fc.assert(
      fc.property(fc.array(coinArbitrary), fc.integer({ min: 0, max: 3 }), (availableInputs, numSpends) => {
        const secretKeys = zswap.SecretKeys.fromSeed(new Uint8Array(32).fill(1));
        const setupAvailableCoins: AvailableCoin[] = availableInputs.map((c) => toAvailableCoin(c, secretKeys));

        const spendsRaw = setupAvailableCoins.slice(0, Math.min(numSpends, setupAvailableCoins.length - 1));

        const seen = new Set();
        const spends = spendsRaw.filter((c) => {
          if (seen.has(c.coin.nonce)) return false;
          seen.add(c.coin.nonce);
          return true;
        });
        const networkId = zswap.NetworkId.Undeployed;
        const capability = makeDefaultCoinsAndBalancesCapability();

        const initialState = createInitialState(secretKeys, setupAvailableCoins);

        // Get initial balances before spending
        const stateBeforeSpends = CoreWallet.emptyV1(initialState, secretKeys, NetworkId.fromJs(networkId));
        const initialAvailableBalances = capability.getAvailableBalances(stateBeforeSpends);

        const localState = issueSpendingOfCoins(initialState, secretKeys, spends);
        const state = CoreWallet.emptyV1(localState, secretKeys, NetworkId.fromJs(networkId));
        const pendingBalances = capability.getPendingBalances(state);
        const availableBalances = capability.getAvailableBalances(state);
        const totalBalances = capability.getTotalBalances(state);
        const pendingCoins = capability.getPendingCoins(state);
        const availableCoinsResult = capability.getAvailableCoins(state);
        const totalCoins = capability.getTotalCoins(state);

        const byTypeRemaining = groupByTokenType(availableCoinsResult);
        Object.entries(byTypeRemaining).forEach(([tokenType, values]) => {
          const sum = values.reduce((a, b) => a + b, 0n);
          expect(availableBalances[tokenType]).toEqual(sum);
          expect(totalBalances[tokenType]).toEqual(sum);
          expect(byTypeRemaining[tokenType]).toEqual(values);
          expect(groupByTokenType(totalCoins)[tokenType]).toEqual(values);
        });
        expect(pendingBalances).toEqual({});
        expect(groupByTokenType(pendingCoins)).toEqual({});

        // Verify that available balances decreased by the correct amount from spends
        const byTypeSpent = groupByTokenType(spends);
        Object.entries(byTypeSpent).forEach(([tokenType, values]) => {
          const spentSum = values.reduce((a, b) => a + b, 0n);
          const initialBalance = initialAvailableBalances[tokenType] ?? 0n;
          const finalBalance = availableBalances[tokenType] ?? 0n;
          expect(finalBalance).toEqual(initialBalance - spentSum);
        });

        expect(state.state.pendingSpends.size).toBe(spends.length);
      }),
      { numRuns: 10 },
    );
  });
});
