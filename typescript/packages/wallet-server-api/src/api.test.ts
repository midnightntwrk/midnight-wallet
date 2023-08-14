// import {
//   LedgerState,
//   Transaction,
//   CoinInfo,
//   ZSwapCoinPublicKey,
//   nativeToken,
//   TransactionBuilder,
//   ZSwapDeltas,
//   ZSwapLocalState,
//   ZSwapOutputWithRandomness,
//   ZSwapOffer,
// } from '@midnight/ledger';
// import { mkLedgerTypeCodec } from './api';

// describe('Custom codecs', () => {
//   describe('Public Key', () => {
//     it('maintains decode(encode(x)) = x', () => {
//       const ZSwapCoinPublicKeyCodec = mkLedgerTypeCodec<ZSwapCoinPublicKey>(ZSwapCoinPublicKey);

//       const publicKey = new ZSwapLocalState().coinPublicKey;

//       const treatedPublicKey = ZSwapCoinPublicKeyCodec.decode(ZSwapCoinPublicKeyCodec.encode(publicKey));

//       expect(treatedPublicKey).toMatchObject(publicKey);
//     });
//   });

//   describe('Transaction', () => {
//     it('maintains decode(encode(x)) = x', () => {
//       const token = nativeToken();
//       const txBuilder = new TransactionBuilder(new LedgerState());
//       const coin = new CoinInfo(5n, token);
//       const deltas = new ZSwapDeltas();
//       deltas.insert(token, coin.value);
//       const newState = new ZSwapLocalState();
//       newState.watchFor(coin);
//       const output = ZSwapOutputWithRandomness.new(coin, newState.coinPublicKey);
//       const offer = new ZSwapOffer([], [output.output], [], deltas);
//       txBuilder.addOffer(offer, output.randomness);
//       const tx = txBuilder.intoTransaction().transaction;

//       const TransactionCodec = mkLedgerTypeCodec<Transaction>(Transaction);

//       const treatedTransaction = TransactionCodec.decode(TransactionCodec.encode(tx));

//       expect(treatedTransaction).toMatchObject(tx);
//     });
//   });

//   describe('Coin Info', () => {
//     it('maintains decode(encode(x)) = x', () => {
//       const CoinInfoCodec = mkLedgerTypeCodec<CoinInfo>(CoinInfo);

//       const token = nativeToken();
//       const coin = new CoinInfo(5n, token);

//       const treatedCoinInfo = CoinInfoCodec.decode(CoinInfoCodec.encode(coin));

//       expect(treatedCoinInfo).toMatchObject(coin);
//     });
//   });
// });

describe('dummy test', () => {
  it('should pass', () => {
    expect(true).toBe(true);
  });
});

export {};
