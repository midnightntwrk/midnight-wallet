import { Observable, map, concatMap, of, filter } from 'rxjs';
import {
  MessageTypes,
  ErrorOutputMessage,
  TxRequestStates,
  CalculateTxCostResponse,
  ServerRequest,
  ServerResponse,
  UpdateTxStateResponse,
  UpdateTxStateRequest,
} from '@midnight/wallet-server-api';
import { WalletBuilder } from '@midnight/wallet';
import type { Wallet } from '@midnight/wallet-api';
import type { WebSocket } from 'ws';
import type { WalletServerStateBloc } from './WalletServerStateBloc';
import {
  ServerOutputMessageCodec,
  ServerInputMessage,
  ServerOutputMessage,
  SubmitTxRequest,
  SubmitTxResponse,
  CalculateTxCostRequest,
} from './api';
import { randomUUID } from 'crypto';

export const calculateTxCostController = (
  inputMessage: Observable<CalculateTxCostRequest>,
): Observable<CalculateTxCostResponse> => {
  return inputMessage.pipe(
    concatMap((message) => {
      const { transaction } = message.payload;

      return of({
        type: MessageTypes.calculateTxCostResponse,
        payload: {
          id: randomUUID(),
          state: TxRequestStates.approved,
          estimatedCost: WalletBuilder.calculateCost(transaction) * -1n,
        },
      });
    }),
  );
};

export const submitTxController = (
  inputMessage: Observable<SubmitTxRequest>,
  walletState: WalletServerStateBloc,
  wallet: Wallet,
): Observable<SubmitTxResponse> => {
  return inputMessage.pipe(
    concatMap((message) => {
      const { transaction, newCoins } = message.payload;

      return walletState
        .addRequest({
          type: message.type,
          payload: {
            transaction,
            newCoins,
            fee: WalletBuilder.calculateCost(transaction) * -1n,
          },
        })
        .pipe(
          concatMap((request) => {
            switch (request.state) {
              case TxRequestStates.approved: {
                return wallet.submitTx(transaction, newCoins).pipe(
                  map((txIdentifier) => ({
                    type: MessageTypes.submitTxResponse,
                    payload: {
                      id: request.id,
                      state: TxRequestStates.approved,
                      txIdentifier,
                    },
                  })),
                );
              }
              case TxRequestStates.rejected:
              case TxRequestStates.pending:
              case TxRequestStates.failed:
                return of({
                  type: MessageTypes.submitTxResponse,
                  payload: {
                    id: request.id,
                    state: request.state,
                  },
                });
            }
          }),
        );
    }),
  );
};

export const updateTxStateController = (
  inputMessage: Observable<UpdateTxStateRequest>,
  walletState: WalletServerStateBloc,
): Observable<UpdateTxStateResponse> => {
  return inputMessage.pipe(
    concatMap((message) => {
      const { payload } = message;

      return walletState.updateRequestState(payload.id, payload.state).pipe(map(() => message));
    }),
    map((message) => ({
      type: MessageTypes.updateTxStateResponse,
      payload: {
        id: message.payload.id,
        updated: true,
      },
    })),
  );
};

export const filterController =
  (wallet: Wallet, walletState: WalletServerStateBloc) =>
  (inputMessage: Observable<ServerInputMessage>) =>
  <InputType extends ServerRequest, OutputType extends ServerResponse>(
    type: InputType,
    requestHandler: (
      inputMessage: Observable<Extract<ServerInputMessage, { type: InputType }>>,
      walletState: WalletServerStateBloc,
      wallet: Wallet,
    ) => Observable<Extract<ServerOutputMessage, { type: OutputType }>>,
  ) => {
    return inputMessage.pipe(
      filter((message): message is Extract<ServerInputMessage, { type: InputType }> => message.type === type),
      concatMap((message) => requestHandler(of(message), walletState, wallet)),
    );
  };

export const responseController = (
  ws: WebSocket,
): {
  next: (outputMessage: ServerOutputMessage | ErrorOutputMessage) => void;
  error: (error: any) => void;
} => ({
  next: (outputMessage: ServerOutputMessage | ErrorOutputMessage) => {
    ws.send(JSON.stringify(ServerOutputMessageCodec.encode(outputMessage)));
  },
  error: (error: any) => {
    let errorResponse = typeof error === 'string' ? error : 'Unexpected error occurred';

    if (error instanceof Error) {
      errorResponse = error.message;
    }

    ws.send(JSON.stringify(errorResponse));
  },
});
