---
---

test(unshielded-wallet): assert what a snapshot carries besides its key

Test-only. The serialization tests are about identity — which key encodings are accepted, that an address must derive
from its key, that a legacy bare-string key reads as schnorr. Their fixture already holds a UTXO on each side of the
available/pending split, and nothing asserts that either survives the round trip, so the money the snapshot exists to
carry was the one thing unchecked.

Every value is chosen so a plausible bug cannot satisfy it by accident: a value larger than a double holds exactly, so
a numeric encoding shows up as a wrong number; both dust-registration states, so a field defaulted on the way back is
caught whichever way the default falls; and a sync cursor whose two indices differ.

The applied position is asserted at its literal value, and the source tip is pinned as **rebuilt from it** rather than
carried — the snapshot has no field for the tip, so a restored wallet reports a gap of zero and calls itself caught up
until its first sync update arrives. That records today's behaviour rather than asking for a different one.

Mutation-verified: defaulting the dust-registration flag on the way back leaves **259 of 260** unit tests green and
fails only the new case; restoring pending UTXOs into the available set fails three of these.
