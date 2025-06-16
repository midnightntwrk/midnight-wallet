import { Observable } from 'rxjs';
import { Runtime } from '../Runtime';
import { ProtocolState } from './ProtocolState';

/**
 * Defines a wallet like implementation.
 *
 * @typeParam TTState The type of state that the wallet will maintain and operate over.
 */
export interface WalletLike<TState> {
  readonly runtime: Runtime;

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
}
