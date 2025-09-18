/* eslint-disable @typescript-eslint/no-explicit-any */
import { Scope } from 'effect';
import { Observable } from 'rxjs';
import { Runtime } from '../Runtime';
import { AnyVersionedVariantArray, StateOf, VariantRecord } from './Variant';
import { HList, Poly } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { ProtocolState } from '@midnight-ntwrk/wallet-sdk-abstractions';

/**
 * Defines the static portion of base wallet class definition
 */
export interface BaseWalletClass<TVariants extends AnyVersionedVariantArray, TConfiguration = object> {
  readonly configuration: Readonly<TConfiguration>;
  new (runtime: Runtime<TVariants>, scope: Scope.CloseableScope): WalletLike<TVariants>;
  allVariants(): TVariants;
  allVariantsRecord(): VariantRecord<TVariants>;
  startEmpty<T extends WalletClassLike<TVariants, any>>(walletClass: T): WalletOf<T>;
  startFirst<T extends WalletClassLike<TVariants, any>>(
    walletClass: T,
    state: StateOf<HList.Head<TVariants>>,
  ): WalletOf<T>;
  start<T extends WalletClassLike<TVariants, any>, Tag extends string | symbol>(
    walletClass: T,
    tag: Tag,
    state: StateOf<HList.Find<TVariants, { variant: Poly.WithTag<Tag> }>>,
  ): WalletOf<T>;
}

/**
 * Defines the static portion of wallet-like definition
 */
export interface WalletClassLike<TVariants extends AnyVersionedVariantArray, TWallet extends WalletLike<TVariants>>
  extends BaseWalletClass<TVariants> {
  new (runtime: Runtime<TVariants>, scope: Scope.CloseableScope): TWallet;
}

export type AnyWalletClass<Variants extends AnyVersionedVariantArray> = WalletClassLike<Variants, WalletLike<Variants>>;
export type WalletOf<T> = T extends WalletClassLike<any, infer TWallet> ? TWallet : never;

/**
 * Defines a base wallet-like implementation.
 *
 * @typeParam TVariants Underlying variants
 */
export interface WalletLike<TVariants extends AnyVersionedVariantArray> {
  readonly runtime: Runtime<TVariants>;
  readonly runtimeScope: Scope.CloseableScope;

  /**
   * A stream of state changes over any amount of time that have been processed by the wallet.
   */
  readonly rawState: Observable<ProtocolState.ProtocolState<StateOf<HList.Each<TVariants>>>>;

  /**
   * Stops the wallet
   */
  stop(): Promise<void>;
}
