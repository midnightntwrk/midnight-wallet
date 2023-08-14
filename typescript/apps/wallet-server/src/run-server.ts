import { WalletCodec } from '@midnight/genesis-gen';
import { ZSwapLocalState } from '@midnight/ledger';
import { WalletBuilder } from '@midnight/wallet';
import { Readline, ServerUserInterface } from '@midnight/wallet-cli';
import { MessageTypes, ErrorOutputMessage, ErrorOutputMessageType, TxRequestStates } from '@midnight/wallet-server-api';
import { either } from 'fp-ts';
import { IncomingMessage } from 'http';
import { PathReporter } from 'io-ts/PathReporter';
import {
  concatMap,
  distinctUntilKeyChanged,
  exhaustMap,
  filter,
  firstValueFrom,
  from,
  fromEvent,
  map,
  merge,
  mergeMap,
  Observable,
  of,
  take,
  tap,
} from 'rxjs';
import WebSocket, { MessageEvent, WebSocketServer } from 'ws';
import { ServerInputMessage, ServerInputMessageCodec, ServerOutputMessage, ZSwapCoinPublicKeyCodec } from './api';
import {
  calculateTxCostController,
  filterController,
  responseController,
  submitTxController,
  updateTxStateController,
} from './MessageController';
import { WalletServerStateBloc } from './WalletServerStateBloc';
import { ServerConfig } from './config';

export async function runServer(config: ServerConfig, walletInitialState: ZSwapLocalState) {
  try {
    const wallet = await WalletBuilder.connect(
      `ws://${config.nodeHost}:${config.nodePort}`,
      WalletCodec.encode(walletInitialState),
      'error',
    );

    wallet.start();

    const walletState = new WalletServerStateBloc(await firstValueFrom(wallet.connect()), wallet.balance());
    walletState.start();

    if (config.cli) {
      const walletServerUI = new ServerUserInterface(new Readline(), config.confirmAll);

      walletState.state$
        .pipe(
          tap((state) => walletServerUI.printHeader(ZSwapCoinPublicKeyCodec.encode(state.address), state.balance)),
          map((state) => state.requests.filter((req) => req.state === TxRequestStates.pending)),
          filter((requests) => requests.length > 0),
          map((requests) => requests[0]),
          exhaustMap((request) =>
            from(
              walletServerUI.requestSign({
                id: request.id,
                payload: {
                  fee: request.payload.fee.toString(),
                },
              }),
            ).pipe(concatMap((response) => walletState.updateRequestState(response.id, response.state))),
          ),
        )
        .subscribe();
    }

    const wss = new WebSocketServer({ host: config.host, port: config.port });

    const filterMessage = filterController(wallet, walletState);

    fromEvent(wss, 'connection').subscribe((connection) => {
      const [ws] = connection as [WebSocket, IncomingMessage];

      const responseHandler = responseController(ws);

      const inputMessage = fromEvent(ws, 'message').pipe(
        map((message) => {
          const messageData = (message as MessageEvent).data as string;
          const parsedMessageData = JSON.parse(messageData) as unknown;

          const decodedMessageData = ServerInputMessageCodec.decode(parsedMessageData);

          return either.isRight(decodedMessageData)
            ? decodedMessageData.right
            : {
                type: ErrorOutputMessageType,
                payload: {
                  message: JSON.stringify(PathReporter.report(decodedMessageData)),
                },
              };
        }),
      ) as Observable<ServerInputMessage | ErrorOutputMessage>;

      const outputMessage: Observable<ServerOutputMessage> = inputMessage.pipe(
        mergeMap((message) => {
          if (message.type === ErrorOutputMessageType) {
            return of(message);
          }

          const filteredMessage = filterMessage(of(message));

          switch (message.type) {
            case MessageTypes.submitTxRequest:
              return filteredMessage<typeof MessageTypes.submitTxRequest, typeof MessageTypes.submitTxResponse>(
                MessageTypes.submitTxRequest,
                (message, walletState, wallet) => submitTxController(message, walletState, wallet),
              );
            case MessageTypes.calculateTxCostRequest:
              return filteredMessage<
                typeof MessageTypes.calculateTxCostRequest,
                typeof MessageTypes.calculateTxCostResponse
              >(MessageTypes.calculateTxCostRequest, (message) => calculateTxCostController(message));
            case MessageTypes.stateRequest:
              return walletState.state$.pipe(
                map((state) => ({
                  type: MessageTypes.stateResponse,
                  payload: {
                    address: state.address,
                    balance: state.balance,
                  },
                })),
                take(1),
              );
            case MessageTypes.updateTxStateRequest:
              return filteredMessage<
                typeof MessageTypes.updateTxStateRequest,
                typeof MessageTypes.updateTxStateResponse
              >(MessageTypes.updateTxStateRequest, (message, walletState) =>
                updateTxStateController(message, walletState),
              );
          }
        }),
      );

      const outputMessageSubscription = outputMessage.subscribe(responseHandler);

      const stateSubscription = walletState.state$
        .pipe(
          // currently the only value that changes is the balance
          distinctUntilKeyChanged('balance'),
          map((state) => ({
            type: MessageTypes.stateResponse,
            payload: {
              address: state.address,
              balance: state.balance,
            },
          })),
        )
        .subscribe(responseHandler);

      merge(fromEvent(ws, 'close'), fromEvent(ws, 'unexpected-response')).subscribe(() => {
        outputMessageSubscription.unsubscribe();
        stateSubscription.unsubscribe();
      });
    });
  } catch (error) {
    if (error instanceof Error) {
      console.log(error.message);
      process.exit(1);
    }
  }
}
