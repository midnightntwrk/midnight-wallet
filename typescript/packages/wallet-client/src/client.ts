import {
  Observable,
  throwError,
  map,
  fromEvent,
  filter,
  ReplaySubject,
  concatMap,
  of,
  firstValueFrom,
  take,
} from 'rxjs';
import { WebSocket, MessageEvent } from 'ws';
import type { Wallet } from '@midnight/wallet-api';
import { Transaction, CoinInfo, ZSwapCoinPublicKey, TransactionIdentifier } from '@midnight/ledger';
import { MessageTypes, TxRequestStates, ServerResponse, ServerRequest } from '@midnight/wallet-server-api';
import { InputMessage, OutputMessage, InputMessageCodec, OutputMessageCodec, State } from './api';
import { either } from 'fp-ts';

type GetWebSocket = () => Observable<WebSocket>;

const getResponseType = (requestType: ServerRequest): ServerResponse => {
  switch (requestType) {
    case MessageTypes.submitTxRequest:
      return MessageTypes.submitTxResponse;
    case MessageTypes.stateRequest:
      return MessageTypes.stateResponse;
    case MessageTypes.calculateTxCostRequest:
      return MessageTypes.calculateTxCostResponse;
    default:
      throw new Error('Unknown request type');
  }
};

export class WalletClient implements Wallet {
  #getWebSocket: GetWebSocket;

  readonly #stateChanges = new ReplaySubject<{ state: State }>(1);

  readonly state$: Observable<State> = this.#stateChanges.pipe(map((s) => s.state));

  constructor(getWebSocket: GetWebSocket) {
    this.#getWebSocket = getWebSocket;

    this.send<typeof MessageTypes.stateResponse>({
      type: MessageTypes.stateRequest,
    }).subscribe((response) => {
      const { payload } = response;

      this.#stateChanges.next({ state: payload });
    });
  }

  connect(): Observable<ZSwapCoinPublicKey> {
    return this.state$.pipe(map((state) => state.address));
  }

  submitTx(transaction: Transaction, newCoins: CoinInfo[]): Observable<TransactionIdentifier> {
    return new Observable((observer) => {
      this.send<typeof MessageTypes.submitTxResponse>({
        type: MessageTypes.submitTxRequest,
        payload: {
          transaction,
          newCoins,
        },
      }).subscribe((response) => {
        const { payload } = response;

        if (payload.state === TxRequestStates.approved) {
          observer.next(payload.txIdentifier);

          observer.complete();
        } else if (payload.state === TxRequestStates.rejected) {
          throwError(() => payload);
        }
      });
    });
  }

  private send<T extends ServerResponse>(
    outputMessage: OutputMessage,
  ): Observable<
    Extract<
      InputMessage,
      {
        type: T;
      }
    >
  > {
    return new Observable((observer) => {
      const responseType = getResponseType(outputMessage.type);
      firstValueFrom(this.#getWebSocket())
        .then((ws) => {
          this.listenForMessage(ws)
            .pipe(
              filter((message) => message.type === responseType),
              map((message) => message as Extract<InputMessage, { type: T }>),
            )
            .subscribe({
              next: (message) => {
                observer.next(message);
                observer.complete();
              },
              complete: () => observer.complete(),
            });

          ws.send(JSON.stringify(OutputMessageCodec.encode(outputMessage)));
        })
        .catch((error) => {
          observer.error(error);
          observer.complete();
        });
    });
  }

  private listenForMessage(ws: WebSocket): Observable<InputMessage> {
    return fromEvent(ws, 'message').pipe(
      map((message) => message as MessageEvent),
      map((message) => message.data),
      filter((data): data is string => typeof data === 'string'),
      map((data) => JSON.parse(data) as unknown as InputMessage),
      map((parsed) => InputMessageCodec.decode(parsed)),
      concatMap(
        either.foldW(
          (errors) =>
            new Observable<never>((subscriber) => {
              console.error(errors);
              subscriber.complete();
            }),
          (message) => of(message),
        ),
      ),
      take(1),
    );
  }
}
