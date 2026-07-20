---
paths:
  - 'packages/hd/**'
  - 'packages/address-format/**'
  - 'packages/spec-reference/**'
---

# Spec reference — hard rules

`packages/spec-reference/` is the executable reference for key derivation and address formatting: it generates and
verifies the wallet spec's test vectors (`packages/spec-reference/test-vectors/`), which pin the derivation/formatting
behaviour the spec (`docs/spec/Specification.md`) mandates.

- After **any** change to key derivation (`hd`) or address formatting (`address-format`), regenerate the vectors:
  `yarn workspace @midnightntwrk/wallet-sdk-spec-reference run gen`.
- Treat a vector change as an intentional behaviour change — review the diff, and if it alters output for existing
  inputs, it is a breaking change (changeset + coordinate).
