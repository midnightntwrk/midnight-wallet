---
---

test(shielded-wallet): assert a settled wallet's coin hashes survive a restart, by value

Test-only. Two existing shapes come close. The round-trip property compares a snapshot with the snapshot of its own
restore, and its generator has a maximum transaction count but **no minimum**, so the wallet it runs against may hold
nothing. The mid-crossing cases do hold a coin, but assert the hash map is empty — that being the point of that window.

Neither says what happens to real hashes over real coins, which is what tells the wallet a coin is already spent.

Honest about what this adds: the property test turns out to catch more than expected, because the decoded wallet is
still typed, so a renamed or swapped field changes the second serialization and shows up as a byte difference. The new
detection is **semantic**: deriving the nullifier the way the commitment is derived — a wallet that cannot tell spent
from unspent — leaves **253 of 254** unit tests green and fails only the case that checks the values are real hashes
rather than coin fields copied through. The rest is scope: a fixture guaranteed to hold coins, and failures that name
the field rather than reporting that bytes differ.
