---
'@midnight-ntwrk/wallet-sdk-unshielded-wallet': patch
'@midnight-ntwrk/wallet-sdk-facade': patch
---

In certain cases valid transactions won't contain any intents, which would cause the `WalletFacade.prototype.signRecipe`
fail. Now it won't fail and return same recipe
