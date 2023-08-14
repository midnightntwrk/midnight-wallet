// import {
//   CoinInfo,
//   LedgerState,
//   nativeToken,
//   Transaction,
//   TransactionBuilder,
//   ZSwapDeltas,
//   ZSwapLocalState,
//   ZSwapOffer,
//   ZSwapOutputWithRandomness,
// } from '@midnight/ledger';
// import { pipe } from 'fp-ts/lib/function';
// import { filter, firstValueFrom, Observable, take } from 'rxjs';

// import { WalletClientMessageTypes, TxRequestStates } from '../api';
// import { WalletServerAPI } from '../fake-in-memory';
// import { RecursivePartial, Resource } from '../helpers';

// export interface WalletServerInstance {
//   getAPI: () => Resource<WalletServerAPI>;
// }

// export interface WalletServerAPITestContext {
//   instance: Resource<WalletServerInstance>;
// }

// const buildTx = (): Transaction => {
//   const token = nativeToken();
//   const txBuilder = new TransactionBuilder(new LedgerState());
//   const coin = new CoinInfo(1n, token);
//   const deltas = new ZSwapDeltas();
//   deltas.insert(token, coin.value);
//   const newState = new ZSwapLocalState();
//   newState.watchFor(coin);
//   const output = ZSwapOutputWithRandomness.new(coin, newState.coinPublicKey);
//   const offer = new ZSwapOffer([], [output.output], [], deltas);
//   txBuilder.addOffer(offer, output.randomness);
//   const tx = txBuilder.intoTransaction().transaction;

//   return tx;
// };

// interface Assertions<T> {
//   equal: (expected: T) => void;
//   matchObject: <E extends T & {}>(expected: RecursivePartial<E>) => void;
// }

// const assert = <T>(actual: T): Assertions<T> => {
//   const equal = (expected: T): void => expect(actual).toEqual(expected);
//   const matchObject = (expected: RecursivePartial<T> & {}): void => expect(actual).toMatchObject(expected);

//   return { equal, matchObject };
// };

// const waitFor = <T>(input$: Observable<T>, predicate: (t: T) => boolean): Promise<T> =>
//   pipe(input$, filter(predicate), take(1), (r) => firstValueFrom(r));

// export function runWalletServerAPITest(context: WalletServerAPITestContext): void {
//   describe('Wallet Server API', () => {
//     let instance: WalletServerInstance;
//     let instanceTeardown: () => Promise<void>;

//     beforeEach(async () => {
//       const { value, teardown } = await context.instance.allocate();
//       instance = value;
//       instanceTeardown = teardown;
//     });

//     afterEach(() => instanceTeardown());

//     describe('connecting to wallet', () => {
//       it('wallet connects properly', () =>
//         pipe(
//           instance.getAPI(),
//           Resource.zip(instance.getAPI()),
//           Resource.use(async ([wallet]) => {
//             const stateBefore = await firstValueFrom(wallet.state$);
//             const connectOutput = await wallet.connect();
//             const stateDuringConnect = await waitFor(
//               wallet.state$,
//               (s) =>
//                 s.requests[0].type === WalletClientMessageTypes.connectRequest &&
//                 s.requests[0].state === TxRequestStates.pending,
//             );
//             const stateAfter = await waitFor(wallet.state$, (s) => s.isConnected);

//             assert(stateBefore.isConnected).equal(false);
//             expect(stateDuringConnect.requests).toEqual(
//               expect.arrayContaining([
//                 expect.objectContaining({
//                   id: connectOutput.payload.id,
//                   type: WalletClientMessageTypes.connectRequest,
//                   state: TxRequestStates.pending,
//                 }),
//               ]),
//             );
//             assert(stateAfter).matchObject({
//               balance: 1n,
//               isConnected: true,
//               requests: [
//                 {
//                   id: connectOutput.payload.id,
//                   type: WalletClientMessageTypes.connectRequest,
//                   state: TxRequestStates.approved,
//                 },
//               ],
//             });
//           }),
//         ));

//       it('cannot connect more than once', () =>
//         pipe(
//           instance.getAPI(),
//           Resource.zip(instance.getAPI()),
//           Resource.use(async ([wallet]) => {
//             await wallet.connect();
//             await waitFor(wallet.state$, (s) => s.isConnected);
//             const secondConnectOutput = await wallet.connect();

//             assert(secondConnectOutput).matchObject({
//               type: WalletClientMessageTypes.connectResponse,
//               payload: {
//                 id: secondConnectOutput.payload.id,
//                 state: TxRequestStates.rejected,
//               },
//             });
//           }),
//         ));
//     });

//     describe('submitting transaction', () => {
//       it('transaction is properly submitted', () =>
//         pipe(
//           instance.getAPI(),
//           Resource.zip(instance.getAPI()),
//           Resource.use(async ([wallet]) => {
//             const connectOutput = await wallet.connect();
//             const stateBefore = await waitFor(wallet.state$, (s) => s.isConnected);
//             const txSubmitOutput = await wallet.submitTx(buildTx());
//             const stateDuringTxSubmit = await waitFor(
//               wallet.state$,
//               (s) =>
//                 s.requests.length > 1 &&
//                 s.requests[1].type === WalletClientMessageTypes.submitTxRequest &&
//                 s.requests[1].state === TxRequestStates.pending,
//             );
//             const stateAfter = await waitFor(
//               wallet.state$,
//               (s) =>
//                 s.requests.length > 1 &&
//                 s.requests[1].type === WalletClientMessageTypes.submitTxRequest &&
//                 s.requests[1].state === TxRequestStates.approved,
//             );

//             assert(stateBefore.isConnected).equal(true);
//             assert(stateBefore.requests.length).equal(1);
//             assert(stateDuringTxSubmit.requests.length).equal(2);
//             assert(stateDuringTxSubmit.requests[1]).matchObject({
//               id: txSubmitOutput.payload.id,
//               type: WalletClientMessageTypes.submitTxRequest,
//               state: TxRequestStates.pending,
//             });
//             assert(stateAfter).matchObject({
//               balance: 1n,
//               isConnected: true,
//               requests: [
//                 {
//                   id: connectOutput.payload.id,
//                   type: WalletClientMessageTypes.connectRequest,
//                   state: TxRequestStates.approved,
//                 },
//                 {
//                   id: txSubmitOutput.payload.id,
//                   type: WalletClientMessageTypes.submitTxRequest,
//                   state: TxRequestStates.approved,
//                 },
//               ],
//             });
//           }),
//         ));

//       it('transaction rejected when not connected', () =>
//         pipe(
//           instance.getAPI(),
//           Resource.zip(instance.getAPI()),
//           Resource.use(async ([wallet]) => {
//             const stateBefore = await firstValueFrom(wallet.state$);
//             const txSubmitOutput = await wallet.submitTx(buildTx());
//             const stateAfter = await waitFor(
//               wallet.state$,
//               (s) =>
//                 s.requests[0].type === WalletClientMessageTypes.submitTxRequest &&
//                 s.requests[0].state === TxRequestStates.rejected,
//             );

//             assert(stateBefore.isConnected).equal(false);
//             assert(stateAfter).matchObject({
//               balance: 0n,
//               isConnected: false,
//               requests: [
//                 {
//                   id: txSubmitOutput.payload.id,
//                   type: WalletClientMessageTypes.submitTxRequest,
//                   state: TxRequestStates.rejected,
//                 },
//               ],
//             });
//           }),
//         ));
//     });
//   });
// }
export {};
