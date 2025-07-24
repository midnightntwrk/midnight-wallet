// This declaration is needed to fix the type errors in the zswap package.
// It is a workaround to the fact that the zswap package is not typed correctly.
// This is a temporary solution that will be removed once the zswap package is typed correctly.
import 'node_modules/@midnight-ntwrk/zswap';

declare module '@midnight-ntwrk/zswap' {
  export function coin_nullifier(coin: CoinInfo, secretKeys: SecretKeys): Nullifier;
  export function coin_commitment(coin: CoinInfo, coinPublicKey: CoinPublicKey): CoinCommitment;
}
