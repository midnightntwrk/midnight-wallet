/* eslint-disable @typescript-eslint/no-explicit-any */
import { Scope } from 'effect';
import { Observable } from 'rxjs';
import { Runtime } from '../Runtime';
import * as Poly from '../utils/polyFunction';
import { ProtocolState } from './ProtocolState';
import { AnyVersionedVariantArray, StateOf } from './Variant';
import * as H from '../utils/hlist';

/**
 * Defines the static portion of base wallet class definition
 */
export interface BaseWalletClass<TVariants extends AnyVersionedVariantArray> {
  new (runtime: Runtime<TVariants>, scope: Scope.CloseableScope): WalletLike<TVariants>;
  allVariants(): TVariants;
  startEmpty<T extends WalletClassLike<TVariants, any>>(walletClass: T): WalletOf<T>;
  startFirst<T extends WalletClassLike<TVariants, any>>(walletClass: T, state: StateOf<H.Head<TVariants>>): WalletOf<T>;
  start<T extends WalletClassLike<TVariants, any>, Tag extends string | symbol>(
    walletClass: T,
    tag: Tag,
    state: StateOf<H.Find<TVariants, { variant: Poly.WithTag<Tag> }>>,
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
  readonly state: Observable<ProtocolState<StateOf<H.Each<TVariants>>>>;

  /**
   * Returns an indicator whether the underlying state of the wallet is fully synchronized.
   *
   * @remarks
   * This property is `true` when the lag is zero, indicating that the wall has processed all
   * updates; otherwise it is `false`. This indicator changes as lag processing the underlying state changes
   * over time.
   */
  readonly syncComplete: boolean;

  /**
   * Stops the wallet
   */
  stop(): Promise<void>;
}
