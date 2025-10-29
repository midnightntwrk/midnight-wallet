import * as ledger from '@midnight-ntwrk/ledger-v6';
import { NetworkId } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { Array as Arr, Data, Either, Option, pipe, Record } from 'effect';
import { ArrayOps, EitherOps } from '@midnight-ntwrk/wallet-sdk-utilities';
import {
  BALANCE_TRANSACTION_TO_PROVE,
  NOTHING_TO_PROVE,
  ProvingRecipe,
  TRANSACTION_TO_PROVE,
} from './ProvingRecipe.js';
import { CoreWallet } from './CoreWallet.js';
import { AddressError, InsufficientFundsError, OtherWalletError, WalletError } from './WalletError.js';
import {
  BalanceRecipe,
  CoinSelection,
  getBalanceRecipe,
  Imbalances,
  InsufficientFundsError as BalancingInsufficientFundsError,
} from '@midnight-ntwrk/wallet-sdk-capabilities';
import { MidnightBech32m, ShieldedAddress } from '@midnight-ntwrk/wallet-sdk-address-format';
import { ShieldedCostModel, TransactionImbalances } from './TransactionImbalances.js';
import { TransactionTrait } from './Transaction.js';
import { CoinsAndBalancesCapability } from './CoinsAndBalances.js';
import { KeysCapability } from './Keys.js';

export interface TokenTransfer {
  readonly amount: bigint;
  readonly type: ledger.RawTokenType;
  readonly receiverAddress: string;
}

export interface TransactingCapability<TSecrets, TState, TTransaction> {
  balanceTransaction(
    secrets: TSecrets,
    state: TState,
    // That's definitely fine for now, question is whether it is worth bastracting over in general case
    tx: ledger.Transaction<ledger.Signaturish, ledger.Proofish, ledger.Bindingish>,
  ): Either.Either<{ recipe: ProvingRecipe<TTransaction>; newState: TState }, WalletError>;

  makeTransfer(
    secrets: TSecrets,
    state: TState,
    outputs: ReadonlyArray<TokenTransfer>,
  ): Either.Either<{ recipe: ProvingRecipe<TTransaction>; newState: TState }, WalletError>;

  initSwap(
    secrets: TSecrets,
    state: TState,
    desiredInputs: Record<ledger.RawTokenType, bigint>,
    desiredOutputs: ReadonlyArray<TokenTransfer>,
  ): Either.Either<{ recipe: ProvingRecipe<TTransaction>; newState: TState }, WalletError>;

  //These functions below do not exactly match here, but also seem to be somewhat good place to put
  //The reason is that they primarily make sense in a wallet flavour only able to issue transactions
  revert(state: TState, tx: TTransaction): Either.Either<TState, WalletError>;

  revertRecipe(state: TState, recipe: ProvingRecipe<TTransaction>): Either.Either<TState, WalletError>;
}

export type DefaultTransactingConfiguration = {
  networkId: NetworkId.NetworkId;
};

export type DefaultTransactingContext = {
  coinSelection: CoinSelection<ledger.QualifiedShieldedCoinInfo>;
  coinsAndBalancesCapability: CoinsAndBalancesCapability<CoreWallet>;
  keysCapability: KeysCapability<CoreWallet>;
};

export const makeDefaultTransactingCapability = (
  config: DefaultTransactingConfiguration,
  getContext: () => DefaultTransactingContext,
): TransactingCapability<ledger.ZswapSecretKeys, CoreWallet, ledger.FinalizedTransaction> => {
  return new TransactingCapabilityImplementation(
    config.networkId,
    () => getContext().coinSelection,
    () => getContext().coinsAndBalancesCapability,
    () => getContext().keysCapability,
    TransactionTrait.default,
  );
};

export const makeSimulatorTransactingCapability = (
  config: DefaultTransactingConfiguration,
  getContext: () => DefaultTransactingContext,
): TransactingCapability<ledger.ZswapSecretKeys, CoreWallet, ledger.ProofErasedTransaction> => {
  return new TransactingCapabilityImplementation(
    config.networkId,
    () => getContext().coinSelection,
    () => getContext().coinsAndBalancesCapability,
    () => getContext().keysCapability,
    TransactionTrait.proofErased,
  );
};

class NoSelfOutputsError extends Data.TaggedError('NoSelfOutputs')<object> {}

export class TransactingCapabilityImplementation<
  TTransaction extends ledger.Transaction<ledger.Signaturish, ledger.Proofish, ledger.Bindingish>,
> implements TransactingCapability<ledger.ZswapSecretKeys, CoreWallet, TTransaction>
{
  public readonly networkId: NetworkId.NetworkId;
  public readonly getCoinSelection: () => CoinSelection<ledger.QualifiedShieldedCoinInfo>;
  public readonly txTrait: TransactionTrait<TTransaction>;
  readonly getCoins: () => CoinsAndBalancesCapability<CoreWallet>;
  readonly getKeys: () => KeysCapability<CoreWallet>;

  constructor(
    networkId: NetworkId.NetworkId,
    getCoinSelection: () => CoinSelection<ledger.QualifiedShieldedCoinInfo>,
    getCoins: () => CoinsAndBalancesCapability<CoreWallet>,
    getKeys: () => KeysCapability<CoreWallet>,
    txTrait: TransactionTrait<TTransaction>,
  ) {
    this.getCoins = getCoins;
    this.networkId = networkId;
    this.getCoinSelection = getCoinSelection;
    this.getKeys = getKeys;
    this.txTrait = txTrait;
  }

  balanceTransaction(
    secretKeys: ledger.ZswapSecretKeys,
    state: CoreWallet,
    tx: TTransaction,
  ): Either.Either<{ recipe: ProvingRecipe<TTransaction>; newState: CoreWallet }, WalletError> {
    return Either.gen(this, function* () {
      const coinSelection = this.getCoinSelection();
      const networkId = this.networkId;
      const initialImbalances = this.txTrait.getImbalances(tx);

      if (TransactionImbalances.areBalanced(initialImbalances)) {
        return {
          recipe: {
            type: NOTHING_TO_PROVE,
            transaction: tx,
          },
          newState: state,
        };
      }

      const { newState: afterFallible, offer: maybeFallible } = yield* this.balanceFallibleSection(
        secretKeys,
        state,
        initialImbalances,
        coinSelection,
      );
      const { newState: afterGuaranteed, offer: guaranteed } = yield* this.#balanceGuaranteedSection(
        secretKeys,
        afterFallible,
        initialImbalances,
        coinSelection,
        0,
        Imbalances.empty(),
      );

      return {
        newState: afterGuaranteed,
        recipe: {
          type: BALANCE_TRANSACTION_TO_PROVE,
          transactionToBalance: tx,
          transactionToProve: ledger.Transaction.fromParts(networkId, guaranteed, maybeFallible),
        },
      };
    });
  }

  makeTransfer(
    secretKeys: ledger.ZswapSecretKeys,
    state: CoreWallet,
    transfers: Arr.NonEmptyReadonlyArray<TokenTransfer>,
  ): Either.Either<{ recipe: ProvingRecipe<TTransaction>; newState: CoreWallet }, WalletError> {
    return Either.gen(this, function* () {
      const networkId = this.networkId;
      const { initialOffersAndCoins, selfCoins } = yield* this.#processDesiredOutputs(state, transfers);
      const offerToBalance = pipe(
        initialOffersAndCoins,
        Arr.map((o) => o.outputOffer),
        ArrayOps.fold((a, b) => a.merge(b)),
      );
      const unprovenTxToBalance = ledger.Transaction.fromParts(networkId, offerToBalance);
      const imbalances = TransactionTrait.unproven.getImbalances(unprovenTxToBalance);
      const { offer, newState } = yield* this.#balanceGuaranteedSection(
        secretKeys,
        state,
        imbalances,
        this.getCoinSelection(),
        selfCoins.length,
        Imbalances.empty(),
      );
      const finalState = CoreWallet.watchCoins(newState, secretKeys, selfCoins);
      const finalTx = unprovenTxToBalance.merge(ledger.Transaction.fromParts(networkId, offer));

      return {
        newState: finalState,
        recipe: {
          type: TRANSACTION_TO_PROVE,
          transaction: finalTx,
        },
      };
    });
  }

  initSwap(
    secretKeys: ledger.ZswapSecretKeys,
    state: CoreWallet,
    desiredInputs: Record<ledger.RawTokenType, bigint>,
    desiredOutputs: ReadonlyArray<TokenTransfer>,
  ): Either.Either<{ recipe: ProvingRecipe<TTransaction>; newState: CoreWallet }, WalletError> {
    return Either.gen(this, function* () {
      const outputsParseResult = yield* this.#processDesiredOutputsPossiblyEmpty(state, desiredOutputs);
      const inputsParseResult = Imbalances.fromEntries(Record.toEntries(desiredInputs));
      const networkId = this.networkId;

      const { offer, newState } = yield* this.#balanceGuaranteedSection(
        secretKeys,
        state,
        TransactionImbalances.empty(),
        this.getCoinSelection(),
        outputsParseResult.selfCoins.length,
        inputsParseResult,
      );
      const finalState = CoreWallet.watchCoins(newState, secretKeys, outputsParseResult.selfCoins);
      const balancingTx = ledger.Transaction.fromParts(networkId, offer);
      const finalTx = outputsParseResult.unprovenTxToBalance
        ? outputsParseResult.unprovenTxToBalance.merge(balancingTx)
        : balancingTx;

      return {
        newState: finalState,
        recipe: {
          type: TRANSACTION_TO_PROVE,
          transaction: finalTx,
        },
      };
    });
  }

  revert(state: CoreWallet, tx: TTransaction): Either.Either<CoreWallet, WalletError> {
    return Either.try({
      try: () => {
        return CoreWallet.revertTransaction(state, tx);
      },
      catch: (err) => {
        return new OtherWalletError({
          message: `Error while reverting transaction ${this.txTrait.id(tx)}`,
          cause: err,
        });
      },
    });
  }

  revertRecipe(state: CoreWallet, recipe: ProvingRecipe<TTransaction>): Either.Either<CoreWallet, WalletError> {
    const doRevert = (tx: ledger.UnprovenTransaction) => {
      return Either.try({
        try: () => {
          return CoreWallet.revertTransaction(state, tx);
        },
        catch: (err) => {
          return new OtherWalletError({
            message: `Error while reverting transaction ${TransactionTrait.unproven.id(tx)}`,
            cause: err,
          });
        },
      });
    };

    switch (recipe.type) {
      case TRANSACTION_TO_PROVE:
        return doRevert(recipe.transaction);
      case BALANCE_TRANSACTION_TO_PROVE:
        return doRevert(recipe.transactionToProve);
      case NOTHING_TO_PROVE:
        return Either.right(state);
    }
  }

  #prepareOffer(
    secretKeys: ledger.ZswapSecretKeys,
    state: CoreWallet,
    recipe: BalanceRecipe<ledger.QualifiedShieldedCoinInfo, ledger.ShieldedCoinInfo>,
    segment: 0 | 1,
  ): Option.Option<{ newState: CoreWallet; offer: ledger.ZswapOffer<ledger.PreProof> }> {
    const [inputOffers, stateAfterSpends] = CoreWallet.spendCoins(state, secretKeys, recipe.inputs, segment);
    const stateAfterWatches = CoreWallet.watchCoins(stateAfterSpends, secretKeys, recipe.outputs);
    const outputOffers = recipe.outputs.map((coin) => {
      const output = ledger.ZswapOutput.new(
        coin,
        segment,
        this.getKeys().getCoinPublicKey(state).toHexString(),
        this.getKeys().getEncryptionPublicKey(state).toHexString(),
      );
      return ledger.ZswapOffer.fromOutput(output, coin.type, coin.value);
    });

    return pipe(
      Arr.appendAll(inputOffers, outputOffers),
      Arr.match({
        onEmpty: () => Option.none<ledger.ZswapOffer<ledger.PreProof>>(),
        onNonEmpty: (nonEmpty) =>
          pipe(
            nonEmpty,
            ArrayOps.fold((a, b) => a.merge(b)),
            Option.some,
          ),
      }),
      Option.map((offer) => ({ offer, newState: stateAfterWatches })),
    );
  }

  balanceFallibleSection(
    secretKeys: ledger.ZswapSecretKeys,
    state: CoreWallet,
    imbalances: TransactionImbalances,
    coinSelection: CoinSelection<ledger.QualifiedShieldedCoinInfo>,
  ): Either.Either<
    {
      offer: ledger.ZswapOffer<ledger.PreProof> | undefined;
      newState: CoreWallet;
    },
    WalletError
  > {
    return Either.try({
      try: () => {
        const fallibleBalanceRecipe = getBalanceRecipe<ledger.QualifiedShieldedCoinInfo, ledger.ShieldedCoinInfo>({
          coins: this.getCoins()
            .getAvailableCoins(state)
            .map((c) => c.coin),
          initialImbalances: imbalances.fallible,
          transactionCostModel: ShieldedCostModel,
          feeTokenType: '',
          coinSelection,
          createOutput: (coin) => ledger.createShieldedCoinInfo(coin.type, coin.value),
          isCoinEqual: (a, b) => a.type === b.type && a.value === b.value,
        });
        return pipe(
          this.#prepareOffer(secretKeys, state, fallibleBalanceRecipe, 1),
          Option.match({
            onNone: () => ({
              newState: state,
              offer: undefined,
            }),
            onSome: (res) => res,
          }),
        );
      },
      catch: (err) => {
        if (err instanceof BalancingInsufficientFundsError) {
          return new InsufficientFundsError({
            message: 'Insufficient funds',
            tokenType: err.tokenType,
            amount: imbalances.fallible.get(err.tokenType) ?? 0n,
          });
        } else {
          return new OtherWalletError({
            message: 'Balancing fallible section failed',
            cause: err,
          });
        }
      },
    });
  }

  #balanceGuaranteedSection(
    secretKeys: ledger.ZswapSecretKeys,
    state: CoreWallet,
    imbalances: TransactionImbalances,
    coinSelection: CoinSelection<ledger.QualifiedShieldedCoinInfo>,
    knownSelfOutputs: number,
    targetImbalances: Imbalances,
  ): Either.Either<{ offer: ledger.ZswapOffer<ledger.PreProof>; newState: CoreWallet }, WalletError> {
    return Either.gen(this, function* () {
      const balanceRecipe = yield* Either.try({
        try: () =>
          getBalanceRecipe<ledger.QualifiedShieldedCoinInfo, ledger.ShieldedCoinInfo>({
            coins: this.getCoins()
              .getAvailableCoins(state)
              .map((c) => c.coin),
            initialImbalances: imbalances.guaranteed,
            transactionCostModel: ShieldedCostModel,
            feeTokenType: '',
            coinSelection,
            createOutput: (coin) => ledger.createShieldedCoinInfo(coin.type, coin.value),
            isCoinEqual: (a, b) => a.nonce === b.nonce,
            targetImbalances,
          }),
        catch: (err) => {
          if (err instanceof BalancingInsufficientFundsError) {
            return new InsufficientFundsError({
              message: 'Insufficient funds',
              tokenType: err.tokenType,
              amount: imbalances.guaranteed.get(err.tokenType) ?? 0n,
            });
          } else {
            return new OtherWalletError({
              message: 'Balancing guaranteed section failed',
              cause: err,
            });
          }
        },
      });

      if (balanceRecipe.outputs.length + knownSelfOutputs == 0) {
        return yield* Either.left(new NoSelfOutputsError({}));
      }

      return yield* pipe(
        this.#prepareOffer(secretKeys, state, balanceRecipe, 0),
        Either.fromOption(() => {
          return new OtherWalletError({
            message: 'Could not create a valid guaranteed offer',
          });
        }),
      );
    }).pipe(
      EitherOps.flatMapLeft((err: NoSelfOutputsError | WalletError) => {
        if (err instanceof NoSelfOutputsError) {
          return this.#balanceGuaranteedWithSelfOutput(secretKeys, state, imbalances, coinSelection, targetImbalances);
        } else {
          return Either.left(err);
        }
      }),
    );
  }

  #balanceGuaranteedWithSelfOutput(
    secretKeys: ledger.ZswapSecretKeys,
    state: CoreWallet,
    imbalances: TransactionImbalances,
    coinSelection: CoinSelection<ledger.QualifiedShieldedCoinInfo>,
    targetImbalances: Imbalances,
  ) {
    return Either.gen(this, function* () {
      const additionalOutputValue = 100_000n;
      const balanceRecipe = yield* Either.try({
        try: () => {
          return getBalanceRecipe<ledger.QualifiedShieldedCoinInfo, ledger.ShieldedCoinInfo>({
            coins: this.getCoins()
              .getAvailableCoins(state)
              .map((c) => c.coin),
            initialImbalances: Imbalances.merge(
              imbalances.guaranteed,
              Imbalances.fromEntry((ledger.shieldedToken() as { raw: string }).raw, -1n * additionalOutputValue),
            ),
            transactionCostModel: ShieldedCostModel,
            feeTokenType: '',
            coinSelection,
            targetImbalances,
            createOutput: (coin) => ledger.createShieldedCoinInfo(coin.type, coin.value),
            isCoinEqual: (a, b) => a.nonce === b.nonce,
          });
        },
        catch: (err) => {
          if (err instanceof BalancingInsufficientFundsError) {
            return new InsufficientFundsError({
              message: 'Insufficient funds',
              tokenType: err.tokenType,
              amount: imbalances.guaranteed.get(err.tokenType) ?? 0n,
            });
          } else {
            return new OtherWalletError({
              message: 'Balancing guaranteed section failed',
              cause: err,
            });
          }
        },
      });
      const additionalCoin = ledger.createShieldedCoinInfo(
        (ledger.shieldedToken() as { raw: string }).raw,
        additionalOutputValue,
      );
      const additionalOffer = pipe(
        additionalCoin,
        (coin) =>
          ledger.ZswapOutput.new(
            coin,
            0,
            this.getKeys().getCoinPublicKey(state).toHexString(),
            this.getKeys().getEncryptionPublicKey(state).toHexString(),
          ),
        (output) =>
          ledger.ZswapOffer.fromOutput(output, (ledger.shieldedToken() as { raw: string }).raw, additionalOutputValue),
      );

      return yield* pipe(
        this.#prepareOffer(secretKeys, state, balanceRecipe, 0),
        Option.map(({ newState, offer }) => {
          return {
            newState: CoreWallet.watchCoins(newState, secretKeys, [additionalCoin]),
            offer: offer.merge(additionalOffer),
          };
        }),
        Either.fromOption(() => {
          return new OtherWalletError({
            message: 'Balancing guaranteed section failed',
          });
        }),
      );
    });
  }

  #parseAddress(addr: string) {
    return Either.try({
      try: () => {
        const repr = MidnightBech32m.parse(addr);
        return ShieldedAddress.codec.decode(this.networkId, repr);
      },
      catch: (err) => {
        return new AddressError({
          message: `Address parsing error: ${addr}`,
          originalAddress: addr,
          cause: err,
        });
      },
    });
  }

  #processDesiredOutputs(state: CoreWallet, transfers: Arr.NonEmptyReadonlyArray<TokenTransfer>) {
    return Either.gen(this, function* () {
      const initialOffersAndCoins = yield* pipe(
        transfers,
        Arr.map((transfer) => {
          return pipe(
            this.#parseAddress(transfer.receiverAddress),
            Either.map((address) => {
              const coin = ledger.createShieldedCoinInfo(transfer.type, transfer.amount);
              const output = ledger.ZswapOutput.new(
                coin,
                0,
                address.coinPublicKey.toHexString(),
                address.encryptionPublicKey.toHexString(),
              );
              const outputOffer = ledger.ZswapOffer.fromOutput(output, transfer.type, transfer.amount);

              return {
                coin,
                outputOffer,
                isForSelf: address.coinPublicKey.equals(this.getKeys().getCoinPublicKey(state)),
              };
            }),
          );
        }),
        Either.all,
      );
      const selfCoins = Arr.flatMap(
        initialOffersAndCoins,
        ({ coin, isForSelf }): readonly ledger.ShieldedCoinInfo[] => {
          if (isForSelf) {
            return [coin];
          } else {
            return [];
          }
        },
      );

      return { initialOffersAndCoins, selfCoins };
    });
  }

  #processDesiredOutputsPossiblyEmpty(state: CoreWallet, desiredOutputs: ReadonlyArray<TokenTransfer>) {
    return pipe(
      desiredOutputs,
      Arr.match({
        onEmpty: () => {
          return Either.right({
            imbalances: TransactionImbalances.empty(),
            selfCoins: [],
            unprovenTxToBalance: null,
          });
        },
        onNonEmpty: (desiredOutputs) => {
          return pipe(
            this.#processDesiredOutputs(state, desiredOutputs),
            Either.map(({ initialOffersAndCoins, selfCoins }) => {
              const networkId = this.networkId;
              const offerToBalance = pipe(
                initialOffersAndCoins,
                Arr.map((o) => o.outputOffer),
                ArrayOps.fold((a, b) => a.merge(b)),
              );
              const unprovenTxToBalance = ledger.Transaction.fromParts(networkId, offerToBalance);
              const imbalances = TransactionTrait.unproven.getImbalances(unprovenTxToBalance);

              return {
                imbalances,
                selfCoins,
                unprovenTxToBalance,
              };
            }),
          );
        },
      }),
    );
  }
}
