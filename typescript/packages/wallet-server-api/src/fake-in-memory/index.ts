// import { Transaction, ZSwapCoinPublicKey, ZSwapLocalState } from '@midnight/ledger';
// import { firstValueFrom, Observable, pipe, shareReplay } from 'rxjs';
// import * as uuid from 'uuid';

// import { Bloc } from '../helpers/bloc';
// import { StateUpdate } from '../helpers/types';
// import { WalletClientMessageTypes, RequestId, TxRequestStates, WalletClientServerOutputMessage } from '../api';
// import { WalletState, WalletServerState } from './WalletState';

// const userPublicKey: ZSwapCoinPublicKey = new ZSwapLocalState().coinPublicKey;

// type WalletStateUpdate = StateUpdate<WalletServerState>;

// class WalletBloc extends Bloc<WalletServerState> {
//   constructor(address: ZSwapCoinPublicKey, balance: bigint) {
//     super({
//       address,
//       balance,
//       isConnected: false,
//       requests: [],
//     });
//   }

//   commit(update: WalletStateUpdate): Promise<void> {
//     return firstValueFrom(this.updateState(update));
//   }
// }

// export interface WalletServerAPI {
//   state$: Observable<WalletServerState>;
//   connect: () => Promise<WalletClientServerOutputMessage>;
//   submitTx: (txPayload: Transaction) => Promise<WalletClientServerOutputMessage>;
// }

// export class FakeInMemoryWalletServer {
//   static prepare(delays: () => Promise<void>): Promise<FakeInMemoryWalletServer> {
//     const walletBloc = new WalletBloc(userPublicKey, 0n);
//     const instance = new FakeInMemoryWalletServer(walletBloc, delays);
//     return Promise.resolve(instance);
//   }

//   constructor(private readonly walletBloc: WalletBloc, private readonly delays: () => Promise<void>) {}

//   start(): Promise<WalletServerAPI> {
//     const walletServerAPI = new FakeInMemoryWalletServerAPI(this.walletBloc, this.delays);

//     return Promise.resolve(walletServerAPI);
//   }
// }

// export class FakeInMemoryWalletServerAPI implements WalletServerAPI {
//   state$: Observable<WalletServerState>;

//   constructor(private readonly walletBloc: WalletBloc, private readonly delay: () => Promise<void>) {
//     this.state$ = this.walletBloc.state$.pipe(shareReplay(1));
//   }

//   connect = (): Promise<
//     Extract<WalletClientServerOutputMessage, { type: typeof WalletClientMessageTypes.connectResponse }>
//   > => {
//     const requestId: RequestId = uuid.v4();
//     void firstValueFrom(this.state$).then((state) => {
//       if (state.isConnected) {
//         return this.walletBloc.commit(
//           WalletState.addRequest({
//             id: requestId,
//             type: WalletClientMessageTypes.connectRequest,
//             state: TxRequestStates.rejected,
//           }),
//         );
//       } else {
//         return this.walletBloc
//           .commit(
//             WalletState.addRequest({
//               id: requestId,
//               type: WalletClientMessageTypes.connectRequest,
//               state: TxRequestStates.pending,
//             }),
//           )
//           .then(() => this.delay())
//           .then(() =>
//             this.walletBloc.commit(
//               pipe(
//                 WalletState.updateRequest({
//                   id: requestId,
//                   type: WalletClientMessageTypes.connectRequest,
//                   state: TxRequestStates.approved,
//                 }),
//                 WalletState.connected(userPublicKey, 1n),
//               ),
//             ),
//           );
//       }
//     });
//     return firstValueFrom(this.state$).then((state) =>
//       Promise.resolve({
//         type: WalletClientMessageTypes.connectResponse,

//         payload: {
//           id: requestId,
//           state: state.isConnected ? TxRequestStates.rejected : TxRequestStates.approved,
//           address: userPublicKey,
//         },
//       }),
//     );
//   };

//   submitTx = (
//     txPayload: Transaction,
//   ): Promise<Extract<WalletClientServerOutputMessage, { type: typeof WalletClientMessageTypes.submitTxResponse }>> => {
//     const requestId: RequestId = uuid.v4();

//     void firstValueFrom(this.state$).then((state) => {
//       if (!state.isConnected) {
//         return this.walletBloc.commit(
//           WalletState.addRequest({
//             id: requestId,
//             type: WalletClientMessageTypes.submitTxRequest,
//             state: TxRequestStates.rejected,
//             payload: {
//               // @ts-expect-error
//               tx: txPayload,
//               newCoins: [],
//               fee: 0n,
//             },
//           }),
//         );
//       } else {
//         return this.walletBloc
//           .commit(
//             WalletState.addRequest({
//               id: requestId,
//               type: WalletClientMessageTypes.submitTxRequest,
//               state: TxRequestStates.pending,
//               payload: {
//                 // @ts-expect-error
//                 tx: txPayload,
//                 newCoins: [],
//                 fee: 0n,
//               },
//             }),
//           )
//           .then(() => this.delay())
//           .then(() =>
//             this.walletBloc.commit(
//               WalletState.updateRequest({
//                 id: requestId,
//                 type: WalletClientMessageTypes.submitTxRequest,
//                 state: TxRequestStates.approved,
//                 payload: {
//                   // @ts-expect-error
//                   tx: txPayload,
//                   newCoins: [],
//                   fee: 0n,
//                 },
//               }),
//             ),
//           );
//       }
//     });

//     // @ts-expect-error
//     return firstValueFrom(this.state$).then((state) =>
//       Promise.resolve({
//         type: WalletClientMessageTypes.submitTxResponse,
//         payload: {
//           id: requestId,
//           state: state.isConnected ? TxRequestStates.approved : TxRequestStates.rejected,
//           txIdentifier: '',
//         },
//       }),
//     );
//   };
// }
export {};
