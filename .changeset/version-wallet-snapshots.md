---
'@midnightntwrk/wallet-sdk-shielded': minor
'@midnightntwrk/wallet-sdk-unshielded-wallet': minor
'@midnightntwrk/wallet-sdk-dust-wallet': minor
---

Write a format version into every wallet snapshot.

Snapshots now carry `version: 'v1'`. The shape is unchanged: `v1` is what they have always been, so a snapshot written
by an earlier release restores exactly as before and no upgrade runs. Only the label is new. The one exception is the
unshielded snapshot written by the V2 variant, whose key shape differs and which carries `v2`; its own changeset says
how a `v1` snapshot is read.

It earns its keep on the day a snapshot's shape does change. That shape becomes `v2` and a single upgrade step is
written, rather than every reader having to work out which of two undifferentiated shapes it is holding — which is the
position the transaction history was in. A snapshot carrying a version this build does not know is now refused rather
than partly read.

`Serialization` is also exported from `@midnightntwrk/wallet-sdk-dust-wallet/v1`, matching the shielded and unshielded
packages, which already exported it.
