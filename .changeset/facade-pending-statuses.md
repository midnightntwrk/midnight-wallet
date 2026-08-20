---
'@midnightntwrk/wallet-sdk-facade': major
---

**BREAKING:** `FacadeState.pending` is now `readonly PendingTransaction[]` with a tagged `PendingStatus`, in place of
the pending set the services work in.

Each entry carries the transaction handle, when it was submitted, the protocol version it was authored for, and one of
four statuses: `Submitted`, `Confirmed`, `Rejected` (with the segments the chain reported), and `Orphaned` — which
carries `authoredFor` and `chainNow`.

`Orphaned` is deliberately its own arm rather than another rejection. A rejection is the chain's verdict: the node saw
the transaction and refused it. An orphaned transaction has no verdict at all and never will, because its bytes were
authored under a protocol version the chain has moved past and nothing can include them afterwards. The wallet has
already unbooked the coins and recorded the rejection either way; what differs is what an application can tell a user,
and whether resubmitting the same bytes could ever help. The distinction existed underneath already — it was only
reachable by comparing an indexer-shaped status string against a constant the SDK did not export.

The persistence story is unchanged: pending transactions remain session-scoped and are orphaned on a fork.

```diff
- rx.filter((s) => s.pending.all.length === 0)
+ rx.filter((s) => s.pending.length === 0)
```
