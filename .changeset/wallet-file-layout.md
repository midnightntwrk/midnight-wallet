---
---

chore(shielded, unshielded, dust-wallet): name the wallet source files after what they export. In each package,
`<Kind>Wallet.ts` now holds the `<Kind>Wallet` default and `CustomForking<Kind>Wallet`, formerly in
`Forking<Kind>Wallet.ts`; the single-variant `Custom<Kind>Wallet` moves to `SingleVariant<Kind>Wallet.ts`, and the shared
contract (`<Kind>WalletAPI`, `<Kind>WalletState`, `Default<Kind>Configuration`) to `<Kind>WalletAPI.ts`. No exported name
changes, on the package roots or the `./v1` and `./v2` subpaths.
