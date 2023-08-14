import { either } from 'fp-ts';
import { Observable, map, concatMap, of, filter, ReplaySubject, take, throwError, retry } from 'rxjs';
import {
  MessageTypes,
  ServerRequestId,
  ServerResponse,
  TxRequestState,
  TxRequestStates,
} from '@midnight/wallet-server-api';
import {
  State,
  WalletUIClientAPI,
  InputMessage,
  InputMessageCodec,
  OutputMessage,
  OutputMessageCodec,
  SubmitTxResponse,
} from './api';
import { WebSocketSubject, webSocket } from 'rxjs/webSocket';

export class WalletUIClient implements WalletUIClientAPI {
  #ws: WebSocketSubject<unknown>;

  readonly #stateChanges = new ReplaySubject<{ state: State }>(1);

  readonly state$: Observable<State> = this.#stateChanges.pipe(map((s) => s.state));

  constructor(webSocketUrl: string) {
    this.#ws = webSocket(webSocketUrl);

    this.listenForInputMessage()
      .pipe(
        filter((message) => message.type === MessageTypes.stateResponse),
        map((message) => message as Extract<InputMessage, { type: typeof MessageTypes.stateResponse }>),
      )
      .subscribe((message) => {
        this.#stateChanges.next({
          state: {
            address: message.payload.address,
            balance: message.payload.balance,
          },
        });
      });

    // try every 3 seconds to reconnect, and update state on reconnect
    this.#ws
      .pipe(
        retry({
          delay: 3000,
        }),
      )
      .subscribe((message) => {
        const { payload, type } = message as InputMessage;

        if (type === MessageTypes.stateResponse) {
          this.#stateChanges.next({
            state: {
              address: payload.address,
              balance: payload.balance,
            },
          });
        } else {
          console.log(`Received message of type ${type} on reconnect with payload: `, payload);
        }
      });
  }

  calculateTxCost(transaction: string): Observable<bigint> {
    return new Observable((observer) => {
      this.send<typeof MessageTypes.calculateTxCostResponse>({
        type: MessageTypes.calculateTxCostRequest,
        payload: {
          transaction,
        },
      }).subscribe((response) => {
        const { payload } = response;

        if (payload.state === TxRequestStates.approved) {
          observer.next(payload.estimatedCost);
        } else {
          throwError(() => payload);
        }
      });
    });
  }

  disconnect(): void {
    this.#ws.unsubscribe();
  }

  submitTx(transaction: string, newCoins: string[]): Observable<SubmitTxResponse> {
    return this.send<typeof MessageTypes.submitTxResponse>({
      type: MessageTypes.submitTxRequest,
      payload: {
        transaction,
        newCoins,
      },
    });
  }

  updateTxState(id: ServerRequestId, state: TxRequestState): Observable<boolean> {
    return new Observable((observer) => {
      this.send<typeof MessageTypes.updateTxStateResponse>({
        type: MessageTypes.updateTxStateRequest,
        payload: {
          id,
          state,
        },
      }).subscribe((response) => {
        const { payload } = response;

        if (payload != null) {
          observer.next(payload.updated);
        } else {
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
    const listenerType =
      outputMessage.type === MessageTypes.submitTxRequest
        ? MessageTypes.submitTxResponse
        : MessageTypes.calculateTxCostResponse;

    return new Observable((observer) => {
      this.listenForInputMessage()
        .pipe(
          filter((message) => message.type === listenerType),
          map((message) => message as Extract<InputMessage, { type: T }>),
          take(2), // @TODO: improve
        )
        .subscribe({
          next: (message) => observer.next(message),
          complete: () => observer.complete(),
          error: (error) => observer.error(error),
        });

      this.#ws.next(OutputMessageCodec.encode(outputMessage));
    });
  }

  private listenForInputMessage(): Observable<InputMessage> {
    return this.#ws.pipe(
      // this can be done when the websocket is initialized - @TODO in a future task.
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
    );
  }
}
