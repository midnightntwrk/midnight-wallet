// This file is part of MIDNIGHT-WALLET-SDK.
// Copyright (C) 2025 Midnight Foundation
// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0 (the "License");
// You may not use this file except in compliance with the License.
// You may obtain a copy of the License at
// http://www.apache.org/licenses/LICENSE-2.0
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
import * as ledger from '@midnight-ntwrk/ledger-v7';
import { NetworkId } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { Array as Arr, Either, Option, pipe, Record } from 'effect';
import { ArrayOps } from '@midnight-ntwrk/wallet-sdk-utilities';
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
import { TransactionOps } from './TransactionOps.js';
import { CoinsAndBalancesCapability } from './CoinsAndBalances.js';
import { KeysCapability } from './Keys.js';

export interface TokenTransfer {
  readonly amount: bigint;
  readonly type: ledger.RawTokenType;
  readonly receiverAddress: string;
}

export type BalancingResult = ledger.UnprovenTransaction | undefined;

export interface TransactingCapability<TSecrets, TState, TTransaction> {
  balanceTransaction(
    secrets: TSecrets,
    state: TState,
    // That's definitely fine for now, question is whether it is worth bastracting over in general case
    tx: ledger.Transaction<ledger.Signaturish, ledger.Proofish, ledger.Bindingish>,
  ): Either.Either<[BalancingResult, TState], WalletError>;

  makeTransfer(
    secrets: TSecrets,
    state: TState,
    outputs: ReadonlyArray<TokenTransfer>,
  ): Either.Either<[ledger.UnprovenTransaction, TState], WalletError>;

  initSwap(
    secrets: TSecrets,
    state: TState,
    desiredInputs: Record<ledger.RawTokenType, bigint>,
    desiredOutputs: ReadonlyArray<TokenTransfer>,
  ): Either.Either<[ledger.UnprovenTransaction, TState], WalletError>;

  //These functions below do not exactly match here, but also seem to be somewhat good place to put
  //The reason is that they primarily make sense in a wallet flavour only able to issue transactions
  revertTransaction(
    state: TState,
    transaction: TTransaction | ledger.UnprovenTransaction,
  ): Either.Either<TState, WalletError>;
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
    TransactionOps.default,
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
    TransactionOps.proofErased,
  );
};

export class TransactingCapabilityImplementation<
  TTransaction extends ledger.Transaction<ledger.Signaturish, ledger.Proofish, ledger.Bindingish>,
> implements TransactingCapability<ledger.ZswapSecretKeys, CoreWallet, TTransaction> {
  public readonly networkId: NetworkId.NetworkId;
  public readonly getCoinSelection: () => CoinSelection<ledger.QualifiedShieldedCoinInfo>;
  public readonly txTrait: TransactionOps<TTransaction>;
  readonly getCoins: () => CoinsAndBalancesCapability<CoreWallet>;
  readonly getKeys: () => KeysCapability<CoreWallet>;

  constructor(
    networkId: NetworkId.NetworkId,
    getCoinSelection: () => CoinSelection<ledger.QualifiedShieldedCoinInfo>,
    getCoins: () => CoinsAndBalancesCapability<CoreWallet>,
    getKeys: () => KeysCapability<CoreWallet>,
    txTrait: TransactionOps<TTransaction>,
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
  ): Either.Either<[BalancingResult, CoreWallet], WalletError> {
    return Either.gen(this, function* () {
      const coinSelection = this.getCoinSelection();
      const initialImbalances = this.txTrait.getImbalances(tx);

      if (TransactionImbalances.areBalanced(initialImbalances)) {
        return [undefined, state];
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
        Imbalances.empty(),
      );

      return [ledger.Transaction.fromParts(this.networkId, guaranteed, maybeFallible), afterGuaranteed];
    });
  }

  makeTransfer(
    secretKeys: ledger.ZswapSecretKeys,
    state: CoreWallet,
    transfers: Arr.NonEmptyReadonlyArray<TokenTransfer>,
  ): Either.Either<[ledger.UnprovenTransaction, CoreWallet], WalletError> {
    return Either.gen(this, function* () {
      const positiveTransfers = yield* pipe(
        transfers,
        Arr.filter((t) => t.amount > 0n),
        Arr.match({
          onEmpty: () =>
            Either.left(
              new OtherWalletError({
                message: 'The amount needs to be positive',
              }),
            ),
          onNonEmpty: (nonEmpty) => Either.right(nonEmpty),
        }),
      );

      const networkId = this.networkId;
      const { initialOffersAndCoins, selfCoins } = yield* this.#processDesiredOutputs(state, positiveTransfers);
      const offerToBalance = pipe(
        initialOffersAndCoins,
        Arr.map((o) => o.outputOffer),
        ArrayOps.fold((a, b) => a.merge(b)),
      );
      const unprovenTxToBalance = ledger.Transaction.fromParts(networkId, offerToBalance);
      const imbalances = TransactionOps.unproven.getImbalances(unprovenTxToBalance);
      const { offer, newState } = yield* this.#balanceGuaranteedSection(
        secretKeys,
        state,
        imbalances,
        this.getCoinSelection(),
        Imbalances.empty(),
      );
      const finalState = CoreWallet.watchCoins(newState, secretKeys, selfCoins);
      const finalTx = unprovenTxToBalance.merge(ledger.Transaction.fromParts(networkId, offer));

      return [finalTx, finalState];
    });
  }

  initSwap(
    secretKeys: ledger.ZswapSecretKeys,
    state: CoreWallet,
    desiredInputs: Record<ledger.RawTokenType, bigint>,
    desiredOutputs: ReadonlyArray<TokenTransfer>,
  ): Either.Either<[ledger.UnprovenTransaction, CoreWallet], WalletError> {
    return Either.gen(this, function* () {
      const outputsValid = desiredOutputs.every((output) => output.amount > 0n);
      if (!outputsValid) {
        return yield* Either.left(
          new OtherWalletError({
            message: 'The amount needs to be positive',
          }),
        );
      }

      const inputsValid = Object.entries(desiredInputs).every(([, amount]) => amount > 0n);
      if (!inputsValid) {
        return yield* Either.left(
          new OtherWalletError({
            message: 'The input amounts need to be positive',
          }),
        );
      }

      const outputsParseResult = yield* this.#processDesiredOutputsPossiblyEmpty(state, desiredOutputs);
      const inputsParseResult = Imbalances.fromEntries(Record.toEntries(desiredInputs));
      const networkId = this.networkId;

      const { offer, newState } = yield* this.#balanceGuaranteedSection(
        secretKeys,
        state,
        TransactionImbalances.empty(),
        this.getCoinSelection(),
        inputsParseResult,
      );
      const finalState = CoreWallet.watchCoins(newState, secretKeys, outputsParseResult.selfCoins);
      const balancingTx = ledger.Transaction.fromParts(networkId, offer);
      const finalTx = outputsParseResult.unprovenTxToBalance
        ? outputsParseResult.unprovenTxToBalance.merge(balancingTx)
        : balancingTx;

      return [finalTx, finalState];
    });
  }

  revertTransaction(
    state: CoreWallet,
    transaction: TTransaction | ledger.UnprovenTransaction,
  ): Either.Either<CoreWallet, WalletError> {
    return Either.try({
      try: () => {
        return CoreWallet.revertTransaction(state, transaction);
      },
      catch: (err) => {
        return new OtherWalletError({
          message: `Error while reverting transaction ${transaction.identifiers().at(0)!}`,
          cause: err,
        });
      },
    });
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

      return yield* pipe(
        this.#prepareOffer(secretKeys, state, balanceRecipe, 0),
        Either.fromOption(() => {
          return new OtherWalletError({
            message: 'Could not create a valid guaranteed offer',
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
              const imbalances = TransactionOps.unproven.getImbalances(unprovenTxToBalance);

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
