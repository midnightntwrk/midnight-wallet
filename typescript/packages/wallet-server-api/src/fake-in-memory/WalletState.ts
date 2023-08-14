// import { ZSwapCoinPublicKey } from '@midnight/ledger';

// import { RequestId, TxRequestState, ConnectRequest, SubmitTxRequestWithFee } from '../api';
// import { block } from '../helpers/functions';

// export interface RequestBase {
//   id: RequestId;
//   state: TxRequestState;
// }

// export type Request = (ConnectRequest & RequestBase) | (SubmitTxRequestWithFee & RequestBase);

// export interface WalletServerState {
//   address: ZSwapCoinPublicKey;
//   balance: bigint;
//   isConnected: boolean;
//   requests: Request[];
// }

// export const WalletState = block(() => {
//   const addRequest =
//     (request: Request) =>
//     (state: WalletServerState): WalletServerState => ({
//       ...state,
//       requests: [...state.requests, request],
//     });

//   const updateRequest =
//     (request: Request) =>
//     (state: WalletServerState): WalletServerState => ({
//       ...state,
//       requests: state.requests.map((req) => (req.id === request.id ? request : req)),
//     });

//   const connected =
//     (address: ZSwapCoinPublicKey, balance: bigint) =>
//     (state: WalletServerState): WalletServerState => ({
//       ...state,
//       isConnected: true,
//       address,
//       balance,
//     });

//   return { addRequest, updateRequest, connected };
// });
export {};
