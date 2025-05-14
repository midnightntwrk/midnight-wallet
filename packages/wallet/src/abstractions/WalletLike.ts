import { Observable } from 'rxjs';
import { ProtocolState } from './ProtocolState';

/**
 * Defines a wallet like implementation.
 *
 * @typeParam TTransaction The type of transaction that the wallet will operate over.
 * @typeParam TTState The type of state that the wallet will maintain and operate over.
 */
export interface WalletLike<TTransaction, TState> {
  /**
   * A stream of state changes over any amount of time that have been processed by the wallet.
   */
  readonly state: Observable<ProtocolState<TState>>;

  /**
   * Returns an indicator as to whether the underlying state of the wallet is fully synchronized.
   *
   * @remarks
   * This property is `true` when the lag is zero, indicating that the wall has processed all
   * updates; otherwise it is `false`. This indicator changes as lag processing the underlying state changes
   * over time.
   */
  readonly syncComplete: boolean;

  balanceTransaction(tx: TTransaction): Promise<TTransaction>;
  // proveTransaction(recipe: unknown): Promise<TTransaction>;
}
