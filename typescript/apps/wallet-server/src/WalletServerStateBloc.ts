import { ZSwapCoinPublicKey } from '@midnight/ledger';
import { Bloc, ServerRequestId, TxRequestState, TxRequestStates } from '@midnight/wallet-server-api';
import { randomUUID } from 'crypto';
import { concatMap, filter, map, Observable, Subscription, takeWhile } from 'rxjs';
import { SubmitTxRequestWithFee } from './api';

export interface Request extends SubmitTxRequestWithFee {
  id: ServerRequestId;
  state: TxRequestState;
}

export interface WalletServerState {
  address: ZSwapCoinPublicKey;
  balance: bigint;
  isConnected: boolean;
  requests: Request[];
}

export class WalletServerStateBloc extends Bloc<WalletServerState> {
  constructor(address: ZSwapCoinPublicKey, private readonly balance$: Observable<bigint>) {
    super({
      isConnected: false,
      address,
      balance: 0n,
      requests: [],
    });
  }

  start(): Subscription {
    return this.balance$.pipe(concatMap((balance) => this.updateState((state) => ({ ...state, balance })))).subscribe();
  }

  addRequest(request: SubmitTxRequestWithFee): Observable<Request> {
    const id = randomUUID();
    const finalStates: TxRequestState[] = [TxRequestStates.rejected, TxRequestStates.failed, TxRequestStates.approved];

    return this.add({
      ...request,
      id,
      state: TxRequestStates.pending,
    }).pipe(
      concatMap(() => this.state$),
      map((state) => state.requests.find((r) => r.id === id)),
      filter((maybeRequest): maybeRequest is Request => maybeRequest !== undefined),
      takeWhile((request) => !finalStates.includes(request.state), true),
    );
  }

  private add(request: Request): Observable<void> {
    return this.updateState((state) => ({
      ...state,
      requests: [...state.requests, request],
    }));
  }

  updateRequest(request: Request): Observable<void> {
    return this.updateState((state) => {
      return {
        ...state,
        requests: state.requests.map((req) => (req.id === request.id ? request : req)),
      };
    });
  }

  updateRequestState(id: ServerRequestId, requestState: TxRequestState): Observable<void> {
    return this.updateState((state) => {
      return {
        ...state,
        requests: state.requests.map((request) => (request.id === id ? { ...request, state: requestState } : request)),
      };
    });
  }

  updateConnectionStatus(isConnected: boolean): Observable<void> {
    return this.updateState((state) => ({
      ...state,
      isConnected,
    }));
  }
}
