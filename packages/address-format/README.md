# @midnight-ntwrk/wallet-sdk-address-format

Bech32m address encoding and decoding for the Midnight network.

## Installation

```bash
npm install @midnight-ntwrk/wallet-sdk-address-format
```

## Overview

This package provides Bech32m address formatting for the Midnight blockchain. It supports encoding and decoding of
various address types including shielded addresses (for ZK transactions), unshielded addresses (for transparent
transactions), and dust addresses (for fee tokens).

Key features:

- Bech32m encoding/decoding with Midnight-specific prefix (`mn_`)
- Network-aware address formatting (mainnet vs testnet)
- Support for shielded, unshielded, and dust address types
- Type-safe codec system for custom address types

## Usage

### Unshielded Address

For transparent transactions on the Midnight network.

```typescript
import { UnshieldedAddress, MidnightBech32m, mainnet } from '@midnight-ntwrk/wallet-sdk-address-format';
import type { NetworkId } from '@midnight-ntwrk/wallet-sdk-address-format';
import { addressFromKey, signatureVerifyingKey } from '@midnight-ntwrk/ledger-v7';
import { randomBytes } from 'node:crypto';

const networkId: NetworkId = 'preview';

// Derive an unshielded address from a random unshielded secret key
const secretKey = randomBytes(32);
const publicKey = signatureVerifyingKey(secretKey.toString('hex'));
const addressHex = addressFromKey(publicKey);
const unshieldedAddress = new UnshieldedAddress(Buffer.from(addressHex, 'hex'));

// Encode to Bech32m string: mn_addr_preview1...
const encoded = MidnightBech32m.encode(networkId, unshieldedAddress).toString();

// Parse and decode back to UnshieldedAddress
const decoded = MidnightBech32m.parse(encoded).decode(UnshieldedAddress, networkId);

// Compare addresses
unshieldedAddress.equals(decoded); // true

// Mainnet addresses omit the network suffix: mn_addr1...
const mainnetEncoded = MidnightBech32m.encode(mainnet, unshieldedAddress).toString();
```

### Shielded Address

For zero-knowledge transactions on the Midnight network.

```typescript
import {
  ShieldedAddress,
  ShieldedCoinPublicKey,
  ShieldedEncryptionPublicKey,
  MidnightBech32m,
} from '@midnight-ntwrk/wallet-sdk-address-format';
import type { NetworkId } from '@midnight-ntwrk/wallet-sdk-address-format';
import * as ledger from '@midnight-ntwrk/ledger-v7';
import { randomBytes } from 'node:crypto';

const networkId: NetworkId = 'preview';

// Create shielded keys from a seed
const shieldedSeed = randomBytes(32); // Your 32-byte seed
const shieldedKeys = ledger.ZswapSecretKeys.fromSeed(shieldedSeed);

// Create a shielded address from the keys
const shieldedAddress = new ShieldedAddress(
  new ShieldedCoinPublicKey(Buffer.from(shieldedKeys.coinPublicKey, 'hex')),
  new ShieldedEncryptionPublicKey(Buffer.from(shieldedKeys.encryptionPublicKey, 'hex')),
);

// Encode to Bech32m string: mn_shield-addr_preview1...
const encoded = MidnightBech32m.encode(networkId, shieldedAddress).toString();

// Parse and decode back to ShieldedAddress
const decoded = MidnightBech32m.parse(encoded).decode(ShieldedAddress, networkId);

// Access individual key components
decoded.coinPublicKeyString();
decoded.encryptionPublicKeyString();
```

### Dust Address

For fee token operations on the Midnight network.

```typescript
import { DustAddress, MidnightBech32m } from '@midnight-ntwrk/wallet-sdk-address-format';
import type { NetworkId } from '@midnight-ntwrk/wallet-sdk-address-format';
import * as ledger from '@midnight-ntwrk/ledger-v7';
import { randomBytes } from 'node:crypto';

const networkId: NetworkId = 'preview';

// Create a dust secret key from a seed
const dustSeed = randomBytes(32); // Your 32-byte seed
const dustSecretKey = ledger.DustSecretKey.fromSeed(dustSeed);

// Create a dust address from the public key
const dustAddress = new DustAddress(dustSecretKey.publicKey);

// Encode to Bech32m string: mn_dust_preview1...
const encoded = MidnightBech32m.encode(networkId, dustAddress).toString();

// Parse and decode back to DustAddress
const decoded = MidnightBech32m.parse(encoded).decode(DustAddress, networkId);
```

## Address Format

All Midnight addresses use the Bech32m encoding with the following structure:

```
mn_<type>[_<network>]1<data>
```

- `mn` - Midnight prefix
- `type` - Address type identifier (e.g., `shield-addr`, `addr`, `dust`)
- `network` - Optional network identifier (omitted for mainnet)
- `data` - Bech32m-encoded payload

### Address Types

| Type              | Bech32m Type  | Description                                                |
| ----------------- | ------------- | ---------------------------------------------------------- |
| Shielded          | `shield-addr` | Combined coin + encryption public keys for ZK transactions |
| Coin Public Key   | `shield-cpk`  | Shielded coin public key only                              |
| Encryption Key    | `shield-epk`  | Shielded encryption public key only                        |
| Encryption Secret | `shield-esk`  | Shielded encryption secret key                             |
| Unshielded        | `addr`        | Public address for transparent transactions                |
| Dust              | `dust`        | Address for fee token operations                           |

## Exports

### Core Classes

- `MidnightBech32m` - Main class for parsing and encoding Bech32m addresses
- `Bech32mCodec` - Generic codec for creating custom address types

### Address Types

- `ShieldedAddress` - Full shielded address with coin and encryption keys
- `ShieldedCoinPublicKey` - 32-byte coin public key
- `ShieldedEncryptionPublicKey` - 32-byte encryption public key
- `ShieldedEncryptionSecretKey` - Encryption secret key wrapper
- `UnshieldedAddress` - 32-byte transparent address
- `DustAddress` - Fee token address using BLS scalar

### Types and Constants

- `NetworkId` - Type for network identification (`mainnet` symbol or string)
- `mainnet` - Symbol representing the mainnet network
- `FormatContext` - Context type for encoding/decoding
- `BLSScalar` - BLS curve scalar field definition
- `ScaleBigInt` - SCALE codec utilities for bigint encoding
- `Bech32mSymbol` - Symbol for codec attachment
- `HasCodec` - Type helper for codec-enabled classes
- `CodecTarget` - Type helper for extracting codec target type
- `Field` - Type for field definitions

## License

Apache-2.0
