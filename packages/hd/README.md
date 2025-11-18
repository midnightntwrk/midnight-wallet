# Midnight SDK HD Wallet

This package provides support for Hierarchical Deterministic (HD) Wallet.

To allow deterministic derivation of keys for different features, Midnight follows algorithms and structure being a mix of [BIP-32](https://github.com/bitcoin/bips/blob/master/bip-0032.mediawiki), [BIP-44](https://github.com/bitcoin/bips/blob/master/bip-0044.mediawiki) and [CIP-1852](https://github.com/cardano-foundation/CIPs/blob/master/CIP-1852/README.md). Specifically, derivation follows BIP-32, and following path for a key pair is used:

```
m / purpose' / coin_type' / account' / role / index
```

Where:
- `purpose` is integer `44` (`0x8000002c`) - despite extensions, Night part of the hierarchy follows BIP-44
- `coin_type` is integer `2400` (`0x80000960`)
- `account` follows BIP-44 recommendations
- `role` follows table below
- `index` follows BIP-44 recommendations


| Role name            | Value | Description                                             |
|----------------------|-------|---------------------------------------------------------|
| Night External chain | 0     | Night is Midnight's main token of value, Follows BIP-44 |
| Night Internal chain | 1     | as above                                                |
| Dust                 | 2     | Dust is needed to pay fees on Midnight                  |
| Zswap                | 3     | Zswap is a sub-protocol for shielded native tokens      |
| Metadata             | 4     | Keys for signing metadata                               |


## How to derive the keys?
Below you can find an example on how to derive keys from a random seed:

```typescript
import { generateRandomSeed, HDWallet, Roles } from '@midnight-ntwrk/wallet-sdk-hd';

const seed = generateRandomSeed();
const generatedWallet = HDWallet.fromSeed(seed);

if (generatedWallet.type == 'seedOk') {
  const zswapKey = generatedWallet.hdWallet.selectAccount(0).selectRole(Roles.Zswap).deriveKeyAt(0);
  if (zswapKey.type === 'keyDerived') {
    console.log('success', zswapKey.key);
  } else {
    console.error('Error deriving key');
  }
} else {
  console.error('Error generating HDWallet');
}
```
