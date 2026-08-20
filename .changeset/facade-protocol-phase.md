---
'@midnightntwrk/wallet-sdk-facade': major
---

**BREAKING:** `FacadeState`'s constructor takes the fork version as a fifth argument.

Adds `FacadeState.protocol`, additively: a tagged reading of whether the three wallets are settled on one side of the
protocol boundary or still crossing it. Three protocol versions cannot say this on their own — a difference within one
epoch is ordinary synchronization, not a crossing — and around a fork the three wallets disagree for a while because
each learns of the change when its own synchronization reaches it. `Crossing` names the wallets still on the near side,
so an application can say what it is waiting for; `from` is the version the facade stays bound to meanwhile, which is
what `activeProtocolVersion` answers and what anything built during the window is stamped with.
