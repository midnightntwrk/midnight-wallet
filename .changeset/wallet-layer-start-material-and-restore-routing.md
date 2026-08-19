---
'@midnightntwrk/wallet-sdk-runtime': minor
---

Three additions the wallet layer needs to run more than one variant.

**`StartMaterial` — what a wallet retains so it can start sync on any variant.** A wallet that follows the chain across a
protocol boundary starts synchronization more than once, and sync needs key material that is deliberately absent from
anything the wallet serializes. `StartMaterial.fromSeed(seed)` retains the seed every variant derives its own key
material from; `StartMaterial.forVariant(tag, aux)` / `forVariants(entries)` retain key objects per variant.
`StartMaterial.auxFor(material, tag, deriveFromSeed)` produces what a given variant should start with, reporting
`Option.none()` when the wallet holds nothing that variant can use — key objects belong to one ledger version's runtime,
so handing another variant's over would be a wrong answer rather than a missing one. `StartAuxCapability` is the
derivation itself, implemented by a variant because only it knows which key type its sync expects.

**`BaseWalletClass.startAtVariant(walletClass, variant, state)` — starting on a variant resolved at runtime.** The
sibling `start` addresses a variant by a statically known tag, which is what lets it demand exactly that variant's state
type. A tag recovered from data — a snapshot's protocol version, the chain's current version — carries no such static
knowledge, and `HList.Find` over a union of tags resolves to the first registration or to `never`, so the state
parameter it computes is not the one the caller holds. Passing the variant `variantFor` resolved keeps both ends of the
pairing together, and the state is typed as the union of the registered variants' states.

**`RuntimeState` is now distributed over the registered variants** — one `ProtocolState` per variant, rather than one
formed from two unions. `variantTag` is therefore a genuine discriminant: branching on it narrows `state` to what that
variant produces, so selecting the capabilities that understand a state needs no cast. The values published are
unchanged, and an annotation naming the wider form still accepts them; code that asserted the *exact* previous type
shape needs the distributed form instead.
