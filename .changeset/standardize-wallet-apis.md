---
'@midnight-ntwrk/wallet-sdk-dust-wallet': major
'@midnight-ntwrk/wallet-sdk-shielded': major
'@midnight-ntwrk/wallet-sdk-unshielded-wallet': minor
'@midnight-ntwrk/wallet-sdk-facade': major
---

Standardize wallet APIs across shielded, unshielded, and dust wallets

### Breaking Changes

**Dust Wallet:**
- Rename `DustCoreWallet` to `CoreWallet` for consistency
- Rename `walletBalance()` to `balance()` on `DustWalletState`
- Rename `dustPublicKey` to `publicKey` and `dustAddress` to `address` on state objects
- Rename `getDustPublicKey()` to `getPublicKey()` and `getDustAddress()` to `getAddress()` on `KeysCapability`
- Add `getAddress(): Promise<DustAddress>` method to `DustWalletAPI`
- Change `dustReceiverAddress` parameter type from `string` to `DustAddress` in transaction methods

**Shielded Wallet:**
- Rename `startWithShieldedSeed()` to `startWithSeed()` for consistency
- Add `getAddress(): Promise<ShieldedAddress>` method
- Change `receiverAddress` parameter type from `string` to `ShieldedAddress` in transfer methods
- Transaction history getter now throws "not yet implemented" error

**Facade:**
- `TokenTransfer` interface now requires typed addresses (`ShieldedAddress` or `UnshieldedAddress`) instead of strings
- Split `CombinedTokenTransfer` into `ShieldedTokenTransfer` and `UnshieldedTokenTransfer` types
- Address encoding/decoding is now handled internally - consumers pass address objects directly

### Migration Guide

**Before:**
```typescript
const address = MidnightBech32m.encode('undeployed', state.shielded.address).toString();
wallet.transferTransaction([{ type: 'shielded', outputs: [{ receiverAddress: address, ... }] }]);
```

**After:**
```typescript
const address = await wallet.shielded.getAddress();
wallet.transferTransaction([{ type: 'shielded', outputs: [{ receiverAddress: address, ... }] }]);
```
