---
'@midnightntwrk/wallet-sdk-abstractions': minor
'@midnightntwrk/wallet-sdk-capabilities': minor
'@midnightntwrk/wallet-sdk': minor
---

`Signing.Signature`, `Signing.SignatureVerifyingKey`, `Signing.SigningKey` and `Signing.SignatureKind` state the
signature shape in a package that names no ledger version — the one scalar that genuinely changed shape at the protocol
boundary, where the pre-fork ledger writes bare hexadecimal and the current one names the scheme alongside the bytes.

They are structurally the **current** ledger version's own types, so a signer already written against `ledger.Signature`
compiles unchanged. The SDK speaks that shape everywhere and lowers it for the pre-fork variant rather than the reverse:
lifting is total, because the pre-fork ledger has exactly one scheme and naming it is never a guess, while lowering is
partial and refuses a scheme that ledger has never heard of instead of handing over bytes it would misread.

The pre-fork adapter is now stated in terms of these types rather than the ledger's, so there is one definition and not
two, and `UnsupportedSignatureKindError` reaches the umbrella package's root by **promotion**, not restatement: the
class an application catches is the class the SDK threw. Nothing here loads a ledger's WebAssembly — the adapter names
both versions in `import type` alone.
