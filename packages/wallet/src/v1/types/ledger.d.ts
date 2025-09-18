// This declaration is needed to fix the type errors in the ledger package.
// It is a workaround to the fact that the ledger package is not typed correctly.
// This is a temporary solution that will be removed once the ledger package is typed correctly.
import 'node_modules/@midnight-ntwrk/ledger';

declare module '@midnight-ntwrk/ledger' {
  export function coin_nullifier(coin: CoinInfo, secretKeys: SecretKeys): Nullifier;
  export function coin_commitment(coin: CoinInfo, coinPublicKey: CoinPublicKey): CoinCommitment;
}
