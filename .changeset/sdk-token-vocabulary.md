---
'@midnightntwrk/wallet-sdk-abstractions': minor
'@midnightntwrk/wallet-sdk-capabilities': minor
'@midnightntwrk/wallet-sdk-dust-wallet': minor
'@midnightntwrk/wallet-sdk-unshielded-wallet': minor
---

The SDK now names token types for itself: `TokenType`, the `Token` constants and `parseTokenType`. An application that
wanted the Night token type had to call `nativeToken().raw` on a ledger package — importing the thing that changes at a
protocol boundary to read a constant that does not.

`TokenType` is a plain `string` and deliberately **not** a branded type, which is a considered exception to this
codebase's parse-don't-validate default. Balances are `Record<TokenType, bigint>` and a branded key type does not
produce a string index signature: branding here would break every balance read in the SDK and in every application, to
buy a guarantee the values did not need. The guarantee that is worth having is made once, at the boundary, by
`parseTokenType`.

`Token.night` is a string literal rather than a call into a ledger, because it reaches an application through the
umbrella package's root barrel, where no ledger's WebAssembly may be loaded. A test holds the literal to **both** ledger
versions, so it cannot drift from what either chain means.

There is one constant because there is one raw type to name: both ledger versions report the same thirty-two bytes for
the native, shielded and unshielded token, and what distinguishes them is a `tag` on the ledger's own wrapper, which a
balance is not keyed by.
