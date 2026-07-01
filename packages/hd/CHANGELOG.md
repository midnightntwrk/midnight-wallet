# @midnightntwrk/wallet-sdk-hd

## 3.1.0-beta.1

### Patch Changes

- 057701e: fix: pins internal dependencies

## 3.1.0-beta.0

### Minor Changes

- ce4cd19: Repurpose HD derivation role 4 (previously the unused Metadata role) as `Roles.EcdsaUnshielded`. Keys for
  ECDSA unshielded operations are derived under their own role, so the secret scalar is never shared with the schnorr
  roles (0/1) of the same account.

## 3.0.3

### Patch Changes

- e0097fc: `deriveKeyAt`/`deriveKeysAt` now return `keyOutOfBounds` for invalid BIP32 path components (non-integer,
  negative, or `>= 2^31` account/role/index values) instead of leaking the underlying `invalid child index` error thrown
  by `@scure/bip32`.

## 3.0.2

### Patch Changes

- 7f82432: Introduce a shared transaction history storage layer with support for wallet-specific augmentation.
  Reimplement shielded wallet transaction history and refactor unshielded wallet transaction history to use the new
  shared storage.

## 3.0.1

### Patch Changes

- 7ef6ff9: fix: bump package versions

## 3.0.0

### Patch Changes

- fb55d52: Introduce more convenient API for Bech32m address encoding/decoding Remove network id from Dust wallet
  initialization methods (so they are read from the configuration) Introduce FacadeState and add a getter to check for
  sync status of whole facade wallet Introduce CompositeDerivation for HD wallet, so that it is possible to derive keys
  for multiple roles at once
- fb55d52: chore: initialize baseline release after introducing Changesets
- fb55d52: chore: force re-release after workspace failure
- bcef7d8: Allow TX creation with no own outputs

## 3.0.0-beta.8

### Patch Changes

- bcef7d8: Allow TX creation with no own outputs

## 3.0.0-beta.7

### Patch Changes

- fb55d52: Introduce more convenient API for Bech32m address encoding/decoding Remove network id from Dust wallet
  initialization methods (so they are read from the configuration) Introduce FacadeState and add a getter to check for
  sync status of whole facade wallet Introduce CompositeDerivation for HD wallet, so that it is possible to derive keys
  for multiple roles at once

## 3.0.0-beta.6

### Patch Changes

- 2a0d132: chore: force re-release after workspace failure

## 3.0.0-beta.5

### Patch Changes

- ae22baf: chore: initialize baseline release after introducing Changesets
