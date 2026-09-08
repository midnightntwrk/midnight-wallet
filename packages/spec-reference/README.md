# @midnight-ntwrk/wallet-sdk-spec-reference

Reference implementation of Midnight wallet seed derivation, key derivation and address formatting, used to generate and
verify the test vectors in [`test-vectors/`](./test-vectors). It optimizes for readability and parity with the
[Wallet Specification](../../docs/spec/Specification.md) rather than performance or security.

| Vector file                                                 | Specification section                                                 | Covers                                                        |
| ----------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------- |
| [`seedDerivation.json`](./test-vectors/seedDerivation.json) | [Per-wallet seeds](../../docs/spec/Specification.md#per-wallet-seeds) | one master seed to the three per-wallet seeds, by BIP-32 path |
| [`keyDerivation.json`](./test-vectors/keyDerivation.json)   | [Key management](../../docs/spec/Specification.md#key-management)     | a per-wallet seed to that wallet's keys                       |
| [`addresses.json`](./test-vectors/addresses.json)           | [Address format](../../docs/spec/Specification.md#address-format)     | those keys to their hexadecimal and Bech32m forms             |

Regenerate with `yarn workspace @midnightntwrk/wallet-sdk-spec-reference run gen`; the file name of each vector set is
the name of its entry in `TestVectors`, so a new generator produces a new file and a new verification case with no other
wiring. Verification is `yarn test:unit --filter=@midnightntwrk/wallet-sdk-spec-reference`, which regenerates in memory
and compares against what is committed.

Two packages hold byte-identical copies of a vector file so their own suites can read it without depending on this
private package — `packages/address-format/test/addresses.json` and `packages/hd/test/seedDerivation.json`. Both are
copied by hand, so regenerating here means copying there.
