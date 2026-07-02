---
'@midnightntwrk/wallet-sdk-unshielded-wallet': major
'@midnightntwrk/wallet-sdk-facade': major
---

Support asynchronous signers (MPC, HSM) on every signing entry point. The signer callback is now
`(data: Uint8Array) => Promise<ledger.Signature>` (exported as `SignSegment`) instead of a synchronous
`(data) => ledger.Signature`, so out-of-process backends whose secret never materializes in-process — threshold-MPC
coordinators and HSM/PKCS#11 devices — can be plugged into the normal signing path without event-loop-blocking hacks.

Async signing is performed by a new `SigningService` (the Effect/imperative-shell layer, alongside the proving and
submission services); the pure transformations stay in `TransactionOps` (`collectSignableData`, `attachSignatures`),
and the `Transacting` capability no longer carries `signUnprovenTransaction`/`signUnboundTransaction`. A signer
rejection surfaces as a typed `SignError`; a signature-scheme mismatch is still rejected before anything is attached.

`UnshieldedKeystore` keeps its synchronous `signData(data): Signature` primitive and gains a
`signDataAsync(data): Promise<Signature>` counterpart that conforms to the async callback shape, so the keystore can be
passed straight to a signing entry point without wrapping at each call site.

BREAKING CHANGE — every caller of `signRecipe`, `signUnprovenTransaction`, `signUnboundTransaction`,
`registerNightUtxosForDustGeneration`, or `deregisterFromDustGeneration` must return a `Promise` from its signer
callback. The in-process keystore exposes `signDataAsync` for exactly this:

```ts
// before
wallet.signRecipe(recipe, (data) => keystore.signData(data));
// after — pass the keystore's async signer directly
wallet.signRecipe(recipe, keystore.signDataAsync);
// or, for a custom signer, return a Promise: (data) => myBackend.sign(data)
```
