# Midnight Wallet Specification

This document is meant to be a reference for wallet implementors: explaining the differences between other well-known
blockchain protocols, providing details on data needed to successfully create and submit transactions, as well as
provide practical insights. There are some aspects of cryptography and algorithms used, which are unique to Midnight's
wallet, and thus - are explained in more detail, while others, more ubiquitous across the Midnight stack - are meant to
be a target of separate documents.

Midnight hosts a unique set of features, which influence the way Midnight wallet software can operate significantly. In
particular, in comparison to many other blockchain protocols:

- transactions are not sealed with signatures
- usage of zero-knowledge technology requires users to generate proofs, which takes relatively a lot of resources: time,
  CPU and memory
- there are 3 kinds of tokens/resources, each with its own specific way to learn balance and data needed for spending
  it:
  - shielded, which require iterating over every single transaction to learn balance and tracking an ever-growing Merkle
    tree to issue spends
  - unshielded, which are typical UTxO and only require knowing the UTxO to spend it
  - Dust, whose balance can be discovered by tracking data used for its generation and spends, including an ever-growing
    Merkle tree to issue spends

This document comprises a couple of sections:

1. **[Introduction](#introduction)** - which explains, how addressing goals stated for the protocol leads to differences
   mentioned above
2. **[Key management](#key-management)** - where the details of key structure, address format and relationship with
   existing standards are provided
3. **[Address format](#address-format)** - where addresses are described, as well as their formatting
4. **[Transaction structure](#transaction-structure-and-statuses)** - which explains, what data are present in
   transactions
5. **[State management](#state-management)** - where state needed to build transactions is defined, together with
   operations necessary to manipulate it
6. **[Synchronization process](#synchronization-process)**, explaining application mechanics available to obtain wallet
   state synchronized with the chain
7. **[Transaction building](#building-transactions)** - on the details and steps to be performed to build transaction
8. **[Transaction submission](#transaction-submission)** - which mentions the process of submitting transaction,
   including possible impact on state

<!-- TOC -->

- [Midnight Wallet Specification](#midnight-wallet-specification)
  - [Introduction](#introduction)
    - [Non-interactive zero knowledge proofs of knowledge (NIZK)](#non-interactive-zero-knowledge-proofs-of-knowledge-nizk)
    - [Coin nullifiers and commitments](#coin-nullifiers-and-commitments)
    - [Binding randomness](#binding-randomness)
    - [Output encryption and blockchain scanning](#output-encryption-and-blockchain-scanning)
    - [Summary](#summary)
  - [Key management](#key-management)
    - [HD Wallet structure](#hd-wallet-structure)
    - [Night and unshielded tokens keys](#night-and-unshielded-tokens-keys)
    - [Dust keys](#dust-keys)
    - [Shielded token (Zswap) keys](#shielded-token-zswap-keys)
      - [Zswap seed](#zswap-seed)
      - [Output encryption keys](#output-encryption-keys)
      - [Coin keys](#coin-keys)
    - [Scalar sampling](#scalar-sampling)
  - [Address format](#address-format)
    - [Unshielded Payment address](#unshielded-payment-address)
    - [Dust address](#dust-address)
    - [Shielded Payment address](#shielded-payment-address)
    - [Shielded Coin public key](#shielded-coin-public-key)
    - [Shielded Encryption secret key](#shielded-encryption-secret-key)
  - [Transaction structure and statuses](#transaction-structure-and-statuses)
    - [Standard transactions](#standard-transactions)
    - [Mint claim](#mint-claim)
  - [State management](#state-management)
    - [Balances](#balances)
    - [Operations](#operations)
      - [`apply_transaction`](#apply_transaction)
        - [Steps to apply shielded offer of a section](#steps-to-apply-shielded-offer-of-a-section)
        - [Steps to apply unshielded offer of a section](#steps-to-apply-unshielded-offer-of-a-section)
        - [Steps to apply dust actions](#steps-to-apply-dust-actions)
      - [`apply_system_transaction`](#apply_system_transaction)
      - [`finalize_transaction`](#finalize_transaction)
      - [`rollback_last_transaction`](#rollback_last_transaction)
      - [`discard_transaction`](#discard_transaction)
      - [`spend`](#spend)
      - [`watch_for`](#watch_for)
  - [Synchronization process](#synchronization-process)
    - [Indexing service for shielded tokens](#indexing-service-for-shielded-tokens)
    - [Indexing service for unshielded tokens](#indexing-service-for-unshielded-tokens)
    - [Indexing service for Dust](#indexing-service-for-dust)
  - [Building standard transactions](#building-standard-transactions)
    - [Building operations](#building-operations)
      - [Building a shielded input](#building-a-shielded-input)
      - [Building a shielded output](#building-a-shielded-output)
      - [Building a transient](#building-a-transient)
      - [Combining shielded inputs, outputs and transients into a shielded offer](#combining-shielded-inputs-outputs-and-transients-into-a-shielded-offer)
      - [Replacing shielded output with a transient](#replacing-shielded-output-with-a-transient)
      - [Building an unshielded input](#building-an-unshielded-input)
      - [Building an unshielded output](#building-an-unshielded-output)
      - [Combining unshielded inputs and outputs into an unshielded offer](#combining-unshielded-inputs-and-outputs-into-an-unshielded-offer)
      - [Creating a Dust spend](#creating-a-dust-spend)
      - [Creating an intent](#creating-an-intent)
      - [Creating transaction with an intent and shielded offers](#creating-transaction-with-an-intent-and-shielded-offers)
      - [Merging with other transaction](#merging-with-other-transaction)
        - [Merging shielded offers](#merging-shielded-offers)
    - [Building stages](#building-stages)
      - [Prepare transfer](#prepare-transfer)
      - [Prepare a swap](#prepare-a-swap)
      - [Contract call](#contract-call)
      - [Balance transaction](#balance-transaction)
  - [Transaction submission](#transaction-submission)
  <!-- TOC -->

## Introduction

Wallet is an important component in a whole network - it stores and protects user's secret keys and allows to use them
in order to create or confirm transactions.

It is often the case, that for user's convenience, wallets also collect all the data necessary for issuing simple
operations on tokens. Midnight Wallet is no exception in this regard, one could even say, that in case of Midnight, that
data management is a particularly important task because the data needed to create transaction is not only sensitive,
but also computationally expensive to obtain. This is a common property to many, if not all implementations of protocols
based on [Zerocash](http://zerocash-project.org/media/pdf/zerocash-extended-20140518.pdf) and
[CryptoNote](https://bytecoin.org/old/whitepaper.pdf) protocols of privacy-preserving tokens, and Midnight shielded
tokens protocols (including Dust) belong to this family, as they are  
based on [Zswap](https://iohk.io/en/research/library/papers/zswap-zk-snark-based-non-interactive-multi-asset-swaps/) ,
which is related to an evolution of Zerocash protocol.

Zswap, as a protocol for privacy-preserving tokens, has 3 major goals:

1. Maintain privacy of transfers, so that it is impossible to tell:
   - who the input provider (sender) is, unless one is the provider themselves
   - who the output recipient is, unless one created that output or is the recipient
   - what amounts were moved, unless one is receiver of particular output
   - what kinds of tokens were moved, unless one is sender or receiver of the token
2. Allow to maintain privacy, while using a non-interactive protocol. That is - to not need interact with the network or
   other parties after transaction was submitted.
3. Allow to make swap transactions

It appears, these 3 goals combined, motivate usage of specific tools and data structures, that have significant impact
on the wallet. Let's see what they are, and how they are used thorough the lifecycle of a coin.

### Non-interactive zero knowledge proofs of knowledge (NIZK)

They provide one, but crucial capability - prove certain computation was performed according to predefined rules,
without revealing private data inputs. This means that eventually transaction can contain only the zero-knowledge proof
about all the data (including private one) used to build the transaction and some additional data, which has to be
public in order to properly evolve the ledger state and allow it to verify future transactions. And that after
transaction is submitted - there is no need for additional interaction in order to verify transaction validity.

The predefined rules encoded in the proofs are:

- sender has the right to spend coins provided as inputs
- the transaction contains only specific inputs and outputs
- auxiliary data for preventing unbalanced spends (see
  [Coin nullifiers and commitments](#coin-nullifiers-and-commitments))

### Coin nullifiers and commitments

Inputs and outputs of a transaction can be thought as exchanging banknotes - each has its (secret) serial number
(nonce), currency (type) and value. But the goal is to exchange them while maintaining privacy, so nonce, type, and
value should not be publicly available, and at the same time - ledger needs to be assured no tokens are created out of
thin air.

The zero-knowledge proof can assure ledger that no new tokens are created in a transaction - that for each token type
the value in inputs covers the value in outputs up to a certain, publicly known imbalance, which is the difference
between value from outputs and value from inputs. Having this assertion in place, what is left, is to ensure that:

- no coin is ever used twice (double spend)
- coin was indeed created in an earlier transaction

Preventing double spends is achieved using _nullifiers_ - these are hashes, which take as input: coin (value, type and
nonce) and sender secret key. Involvement of sender secret key allows only sender to calculate nullifier that will match
the one encoded in a proof, while the whole coin makes each nullifier unique for that coin. Ledger keeps track of
nullifiers in a set data structure, so that whenever an input provides a nullifier, which already is known to ledger -
it means the transaction should be rejected, because a double spend attempt is taking place.

Ensuring that coin was earlier created as an output is slightly more involved. Firstly, it requires a function to
calculate value called coin commitment. This function takes coin as an input, together with receiver address. This
allows both sender and receiver to calculate the same value, but no one else (because coin nonce is secret). Each output
to the transaction has the commitment publicly readable, and ledger tracks them in a data structure called Merkle tree,
which allows to generate a succinct proof that a value is stored in the tree. Such proof needs to be provided when
spending a coin. If the proof leads to a tree root, which ledger did not register - it means the coin being spent was
not created in a transaction known to the ledger.

### Binding randomness

Many other protocols make use of signature schemes to prevent transaction malleability and prove credentials to issue
transaction. To enable atomic swaps, ultimately needed are (at least) 2 parties, which create matching offers, which
eventually are combined into a single transaction or executed within a single transaction. The approach Zswap is taking
to enable atomic swaps is by allowing controlled malleability - namely merging transactions. But this means known
signature schemes can not be used as they prevent malleability completely. It is already not needed to prove credentials
to issue transaction - each input and output has relevant zero-knowledge proof attached.

It is enabled by a construction called _sparse homomorphic commitment_, which is built from 3 functions:

1. for calculating a value commitment for a set consisting of pairs of coin type and value, and additional random
   element called randomness
2. for combining the value commitments
3. for combining the randomnesses

These functions are carefully selected so that together they provide a really nice properties:

- combining commitments is equal to calculating a commitment for a set being a sum of sets provided to combined
  commitments and randomnesses combined too, that is:
  $commitment(s1, r1) \oplus commitment(s2, r2) = commitment(s1 \cup s2, r1 \circ r2)$
- commitment for a coin when value is equal 0 is equal to a commitment of an empty set:
  $commitment((0, x), r) = commitment(\emptyset, r)$

With such scheme in place one can do the following:

- attach the commitment to each input and output as well as calculate it in its proof (so that proof binds the input or
  output it is attached to)
- combine randomnesses of all inputs and outputs and attach it to the transaction
- attach to transaction imbalances of each token type

This allows to ensure that transaction was not tampered with, because resulting combination of commitments of all
inputs, outputs and imbalances needs to be equal to commitment of an empty set with transaction randomness, if they
differ - it means transaction was tampered with. And, because it is known how to combine both commitments and
randomnesses, it is possible to merge two transactions into one and still make this check pass.

### Output encryption and blockchain scanning

With just zero-knowledge proof no additional interaction is needed to verify transaction, but there is no way for the
receiver to know, that there exists a transaction, which contains a coin meant for them. Attaching any identifier would
end up with not meeting privacy goal, for that reason outputs can have attached coin details, encrypted with receiver's
public key. So that in a pursuit in lack of interaction, one can scan a blockchain transaction outputs for ones that
decrypt successfully with own private key.

### Summary

Zswap reaches its goals of maintaining privacy using a non-interactive protocol and allowing swaps through a combination
of zero-knowledge technology, coin nullifiers and Merkle tree of coin commitments tracked by ledger, sparse homomorphic
commitments and output encryption. This indicates high level goals of wallet software for Midnight, which need to be met
in order to be able to create a transaction, that will be accepted by Midnight's ledger:

- generate proper zero-knowledge proofs
- track coin lifecycle to prevent double spends
- keep access to an up-to-date view on the needed Merkle trees, to generate inclusion proofs for coins owned by
  particular wallet instance
- derive relevant keys
- calculate needed nullifiers and commitments, and combine them accordingly
- encrypt and decrypt outputs
- scan blockchain transactions for own outputs

## Key management

In order to support operations mentioned in the [introduction](#introduction), wallet needs to generate and maintain
number of keys. Additionally, there are existing standards related to key management, which wallets tends to follow for
maintaining consistent user experience and portability of keys. Depending on exact feature - different cryptographic
algorithms are used, which rises need to use a different type of key, as well as a different way of generating the key,
to be used only for that feature.

### HD Wallet structure

To allow deterministic derivation of keys for different features, Midnight follows algorithms and structure being a mix
of [BIP-32](https://github.com/bitcoin/bips/blob/master/bip-0032.mediawiki),
[BIP-44](https://github.com/bitcoin/bips/blob/master/bip-0044.mediawiki) and
[CIP-1852](https://github.com/cardano-foundation/CIPs/blob/master/CIP-1852/README.md). Specifically, derivation follows
BIP-32, and following path for a key pair is used:

```
m / purpose' / coin_type' / account' / role / index
```

Where:

- `purpose` is integer `44` (`0x8000002c`) - despite extensions, Night part of the hierarchy follows BIP-44
- `coin_type` is integer `2400` (`0x80000960`)
- `account` follows BIP-44 recommendations
- `role` follows table below
- `index` follows BIP-44 recommendations

| Role name                             | Value | Description                                                                                        |
| ------------------------------------- | ----- | -------------------------------------------------------------------------------------------------- |
| Unshielded (and Night) External chain | 0     | Following BIP-44, this is main role for unshielded tokens, including Night - Midnight's main token |
| Unshielded (and Night) Internal chain | 1     | Only present for BIP-44 compatibility, can be used to derive change addresses                      |
| Dust                                  | 2     | Dust is needed to pay fees on Midnight                                                             |
| Shielded                              | 3     | Shielded tokens, managed is a Zswap-based sub-protocol                                             |
| Unshielded (and Night) ECDSA          | 4     | ECDSA-only role for unshielded tokens, including Night                                             |

> [!NOTE] `role` and `index` path levels use public derivation for BIP-44 compatibility. For many keys it will not be
> possible to meaningfully perform public parent key -> public child key derivation. In many cases it is only the secret
> key at certain path used to further derive keys specific for particular purpose.
>
> Generally treating keys as uniform bitstrings should not be done, though in this particular case, where secp256k1 base
> field is so close in size to 2^256, it is found that impact on security is negligible, which makes this approach
> acceptable.

### Night and unshielded tokens keys

Unshielded tokens use Schnorr signature over secp256k1 curve as the primary scheme.

That makes a private key derived at a path under role `0` or `1`, the private key for Night. The public key being
derived accordingly, e.g. as specified in [BIP-340](https://github.com/bitcoin/bips/blob/master/bip-0340.mediawiki).

As an opt-in alternative, ECDSA over secp256k1 with SHA-256 (deterministic nonces per
[RFC 6979](https://datatracker.ietf.org/doc/html/rfc6979), low-s per
[BIP-62](https://github.com/bitcoin/bips/blob/master/bip-0062.mediawiki#low-s-values-in-signatures)) is supported for
keys derived under role `4`. The bytes at the leaf path are interpreted as a secp256k1 scalar modulo the curve order;
zero is rejected. The corresponding verifying key is the 33-byte compressed SEC1 encoding of the resulting point.

### Dust keys

Dust uses SNARK-friendly cryptography, where the secret key is an element of the main curve's (BLS12-381) scalar field,
and public key a Poseidon hash of the secret key (so it is also an element of the scalar field). A Dust secret key is
derived using the [Scalar sampling approach](#scalar-sampling) with bytes margin equal 32, and domain separator being
`midnight:dsk`. That is:

```ts
function dustSecretKey(seed: Buffer): BigInt {
  return sampledSecretKey(seed, 'midnight:dsk', 32, BLSScalar);
}
```

In the HD wallet structure, seed for Dust secret key is a secret key derived at certain path.

### Shielded token (Zswap) keys

![](./zswap-keys.svg)

#### Zswap seed

A secret 32 bytes, which allow to generate all the other Zswap keys. Rest of key generation is outlined below. In HD
structure, Zswap seed is obtained as a secret key derived at certain path.

#### Output encryption keys

Encryption secret key is an element of the embedded curve's (JubJub) scalar field, generated using the
[Scalar sampling approach](#scalar-sampling) with bytes margin equal 32, and domain separator being `midnight:esk`. That
is:

```ts
function encryptionSecretKey(seed: Buffer): BigInt {
  return sampledSecretKey(seed, 'midnight:esk', 32, JubJubScalar);
}
```

Although it is a secret key, so it should be treated with a special care, there is one situation, where it can be shared
— as a key letting a trusted backend service index related transactions — in such context it acts as a viewing key.

Encryption public key is derived using Elliptic Curve Diffie-Hellman scheme (so it is a point on the JubJub curve), that
is $esk \cdot G$, where $G$ is JubJub's generator point and $esk$ the encryption secret key.

#### Coin keys

Coin secret key is 32 random bytes, generated as an SHA-256 hash of seed with domain separator `midnight:csk`. Through
coin commitment calculation in a zero-knowledge proof it is a credential to rights to spend particular coin.

Coin public key is 32 bytes calculated as SHA-256 hash of coin secret key prefixed with domain separator
`midnight:zswap-pk[v1]`, that is (in a TS pseudocode):

```ts
function coinPublicKey(coinSecretKey: Buffer): Buffer {
  const DOMAIN_SEPARATOR = Buffer.from('midnight:zswap-pk[v1]');
  return sha256(DOMAIN_SEPARATOR.concat(coinSecretKey.concat));
}
```

### Scalar sampling

Zswap and Dust keys require sampling a scalar value out of uniform bytes. The procedure to follow is the same for both,
with some details specific to a key and curve it is related to. It iteratively hashes provided bytes with a domain
separator until a certain number of bytes is reached (enough to represent every number on the scalar field plus some
more to obtain sufficiently uniform output - see
[The Definitive guide to nodulo bias and how to avoid it](https://web.archive.org/web/20250409021732/https://romailler.ch/2020/07/28/crypto-modulo_bias_guide/)).
Resulting byte sequence is interpreted to scalar assuming a little-endian layout and taken modulo the field prime. In
naive TS code (simplifying for readability):

```ts
function toScalar(bytes: Buffer): BigInt {
  return BigInt(`0x${Buffer.from(bytes).reverse().toString('hex')}`);
}
function sampleBytes(bytes: number, domainSeparator: string, seed: Buffer): Buffer {
  const rounds = Math.ceil(bytes / 32);
  const result = Buffer.alloc(bytes);
  for (const i = 0; i < rounds; i++) {
    const segment = sha256(domainSeparator, sha256(i, seed));
    segment.copy(result, i * 32); // last segment gets truncated if overflows
  }
  return result;
}
type Field = {
  bytes: number; // number of bytes needed to represent any value of the field
  prime: BigInt; // modulus of the field
};
function sampledSecretKey(seed: Buffer, domainSeparator: string, bytesMargin: number, field: Field): BigInt {
  const sampledBytes = sampleBytes(field.bytes + bytesMargin, domainSeparator, seed);
  return toScalar(sampledBytes) % field.prime;
}
```

## Address format

Midnight uses [Bech32m](https://github.com/bitcoin/bips/blob/master/bip-0350.mediawiki) as an address format.

The human-readable part should consist of 3 parts, separated by underscore:

- constant `mn` indicating it is a Midnight address
- type of credential encoded, like `addr` for payment address or `shield-addr` for a shielded payment address. Only
  alphanumeric characters and hyphen are allowed. Hyphen is allowed only to allow usage of multiple segments in
  credential name, so parsing and validation are simplified.
- network identifier - arbitrary string consisting of alphanumeric characters and hyphens, identifying network. Hyphen
  is allowed only to allow usage of multiple segments in network identifier, so parsing and validation are simplified.
  The same value is meant to be used as part of transaction data for consistency verification. For mainnet (the value
  `mainnet`), network identifier has to be omitted (and so its preceding underscore).

### Unshielded Payment address

Primary payment address in the network. It allows receiving Night and other unshielded tokens. The address is always 32
bytes, encoded as-is with no additional prefixes or tags. Its credential type is `addr`.

For Schnorr keys (roles `0` and `1`), the address is `SHA-256(verifying_key)`, where `verifying_key` is the 32-byte
BIP-340 x-only public key.

For ECDSA keys (role `4`), the address is `SHA-256("midnight:ecdsa:" ‖ verifying_key)`, where `verifying_key` is the
33-byte compressed-SEC1-encoded public key. The domain separator binds the address to the ECDSA scheme, preventing
accidental cross-scheme key reuse.

Example human-readable parts:

- for the mainnet (notice no trailing underscore): `mn_addr`
- for the testnet: `mn_addr_test`
- for a testing environment: `mn_addr_testing-env`
- for local development environment: `mn_addr_dev`

### Dust address

It is a Ledger-untagged-serialized Dust public key (which is an element of a scalar field), encoded into bytes as
compact bigint in
[Scale encoding](https://docs.polkadot.com/polkadot-protocol/parachain-basics/data-encoding/#scale-codec-libraries) (so
has a variable length, up to 33 bytes). It represents recipient of Dust generation.

Its credential type is `dust`.

Example human-readable parts:

- for the mainnet: `mn_dust`
- for the testnet: `mn_dust_test`
- for a testing environment: `mn_dust_testing-env`
- for local development environment: `mn_dust_dev`

### Shielded Payment address

It is a concatenation of coin public key (32 bytes - SHA-256 hash of the coin secret key) and ledger-untagged-serialized
encryption public key (a point on the JubJub elliptic curve) encoded into 32 bytes as defined $repr_\mathbb{J}$ in
[Zcash specification 5.4.9.3 - JubJub](https://zips.z.cash/protocol/protocol.pdf#jubjub), but extra canonicity checks
are applied when reading a point (see [ZIP-0216](https://zips.z.cash/zip-0216)).

NOTE: in current form and usage this address structure is prone to malleability, where attacker replaces coin or
encryption public key in the address. It seems that Zcash was prone to this kind of malleability too in Sprout, and it
was acceptable there because of assumption of addresses being securely transmitted. Implementation of diversified
addresses seems to have addressed this malleability by design.

Its credential type is `shield-addr`.

Example human-readable parts:

- for the mainnet: `mn_shield-addr`
- for the testnet: `mn_shield-addr_test`
- for a testing environment: `mn_shield-addr_testing-env`
- for local development environment: `mn_shield-addr_dev`

### Shielded Coin public key

32 bytes of the public key. Credential type is `shield-cpk`.

### Shielded Encryption secret key

Ledger-untagged-serialized encryption secret key (an element of scalar field) encoded into bytes as compact bigint in
[Scale encoding](https://docs.polkadot.com/polkadot-protocol/parachain-basics/data-encoding/#scale-codec-libraries) (so
has a variable length, up to 33 bytes). Credential type is `shield-esk`

## Transaction structure and statuses

<!-- TODO: Refer to ledger spec -->

There are multiple types of supported transactions in Midnight, from the wallet perspective only 2 matter:

1. Standard transactions.
2. Mint claims.

### Standard transactions

A standard Midnight transactions are built with 4 kinds of components, further grouped into intents:

1. A shielded offer.
2. An unshielded offer.
3. A contract action.
4. Dust action

Shielded offer is an atomically applicable, sorted set of shielded inputs, outputs and transients. It also conveys
information on utilised token imbalances (if there are any), because finalized offer does not contain information about
coins values.

Unshielded offer is an atomically applicable, sorted set of unshielded inputs and outputs, together with a set of
signatures authorizing the spends and sealing the intent an offer is part of.

Contract action is a contract call, deploy or a maintenance action.

Dust action is a Dust spend (to pay for fees) or a registration (to start generating Dust).

Each intent is a structure assigned its execution order, determined by an identifier within the transaction. It contains
or refers to shielded and unshielded offers, contract actions and Dust actions within a transaction that are meant to be
executed together (e.g. because they represent a swap of unshielded tokens for shielded ones, which is all done through
a contract).

Transaction can be viewed at through the lens of sections: guaranteed one, and fallible ones. The guaranteed section
includes a shielded offer and a set of unshielded ones (one from each intent). The guaranteed section has to succeed for
the whole transaction to succeed. Fallible sections comprise a shielded offer, unshielded offer and contract actions.
This split makes a transaction execution yield one of the following 3 results:

- success - when guaranteed section and all fallible sections succeed
- failure - when guaranteed section fails, so no fallible section is even executed
- partial success, with succeeding intent ids - when guaranteed section passes, but some (or all) of fallible sections
  fail, the succeeding ones are being returned

Balance of a token within an offer/intent/section is a sum of values of the coins of particular type in the outputs
subtracted from the sum of values of inputs. Only transactions with balances meeting following criteria will be accepted
by ledger:

- for all shielded and unshielded tokens, for each section separately - greater or equal zero
- for Dust spends (to pay fees) - greater or equal to fees to be paid

Because a transaction can always be extended (by adding new intents or merging shielded offers), its hash is not a
reliable identifier to use when looking for transaction confirmation. Instead, transactions should be identified by
their known components: value commitments of shielded offers or binding commitments of intents.

### Mint claim

A system transaction can be issued by Midnight nodes to mint certain amount of tokens as a reward a party. Such minted
tokens can be claimed with dedicated type of transaction. The claim includes:

- Information about the coin created as a result of the claim.
- The recipient's address.
- The signature proving that the recipient is eligible for the claim.

Possible uses of mint transactions are - assigning rewards to SPOs, assigning rewards to SPO delegators, minting tokens
for faucet in testnets.

## State management

Wallet has a state, which needs accurate maintenance in order to be able to use coins in a transaction. Minimally, it
consists of the data needed to spend coins and pay fees

- keys
- a set of own shielded coins
- a Merkle tree of shielded coin commitments
- a set of own unshielded coins
- a set of own Dust generation info paired with Dust actions containing them and their Merkle tree indices
- a set of own Dust outputs paired with Dust actions containing them
- a Merkle tree of Dust generation infos
- a Merkle tree of Dust commitments

Owned coins do not have to be spendable at particular point. They might also be coins that the wallet was let know of,
which are expected to be included in one of the future transactions.

Additionally, it is in practice important to track progress of synchronization with chain, pool of pending transactions
and transaction history.

There are 6 foundational operations defined, which should be atomic to whole wallet state:

- `apply_transaction(transaction, status, timestamp, expected_roots,  genearations_tree_update)` - which updates the
  state with a transaction observed on chain, this operation allows to learn about incoming tokens
- `apply_system_transaction(transaction)` - which allows to discover cNight-based genearations
- `finalize_transaction(transaction)` - which marks transaction as final according to consensus rules
- `rollback_last_transaction` - which reverts effects of applying last transaction
- `discard_transaction(transaction)` - which considers a pending transaction irreversibly failed
- `spend(coins_to_spend, new_coins)` - which spends coins in a new transaction
- `watch_for(coin)` - which adds a coin to explicitly watch for

Functions `apply_transaction`, `finalize_transaction` and `rollback_transaction` can be extended to blocks, ranges of
blocks or other data to reconstruct the wallet state. Since shielded tokens are implemented using effectively a UTxO
model and unshielded tokens are implemented in the UTxO model, the
[Cardano Wallet Formal Specification](https://iohk.io/en/research/library/papers/formal-specification-for-a-cardano-wallet/)
remains relevant read, which has many similarities with the Midnight wallet.

Full transaction lifecycle in relationship to those operations is presented on figure below. Please note, that confirmed
and final transactions have statuses related to their execution.

The status "failure" is conceptually the same as "rejected" (there was no effect on ledger state), with the major
difference being the reason - if transaction was confirmed with "failure" status it meant it was successfully submitted
to the network and there was an attempt of adding it to a block, but it was rejected by ledger rules, so it was added to
a block as a failed one. The "rejected" status means though that transaction was submitted to the network, but there is
no block to include it in any form (because of some intermittent issues or a chain reorganization).

![](./tx-lifecycle.svg)

### Balances

A balance of token in a wallet is a sum of values of coins of that token type.

Because consensus finality is not instant, and sometimes wallet knows about coins before they can be spent, there are 3
distinct balances recognized:

- available - derived from final unspent coins, that is - this is the balance, which wallet is safe to spend at the
  moment, with no risk of transaction being rejected due to coin double spend
- pending - derived from pending coins; this balance represents amount of tokens wallet knows it waits for, but they are
  not final yet
- total - sum of available and pending balances; it represents total amount of tokens under wallet's control, taking
  into consideration known pending transactions and coins

Because of need to book coins for ongoing transactions, coin lifecycle differs from transaction lifecycle as presented
on the figure below:

![](./coin-lifecycle.svg)

### Operations

#### `apply_transaction`

Applies a (standard) transaction to the wallet state. It should receive following parameters:

- transaction to apply, including information about its on-chain execution status (which sections passed)
- containing block's timestamp
- roots of commitments Merkle trees (shielded coin commitments, Dust commitments) - to allow consistency checks
- updated Dust generation Merkle tree or an update with expected root - to allow Dust spends; an alternative is to
  process all transactions (including system ones) and follow ledger algorithm to obtain the same result, which is a
  memory-intensive process, though may be worth the cost if implementation's threat model assumes operation on raw chain
  data; Additional mappings to help in resolving indices of Dust generation infos would be helpful too (e.g. mapping
  from Dust generation info hash to an index in the Merkle tree).

This operation is basis to the synchronization process and primarily serves the purpose of discovering received and
spent coins. Depending on provided status of transaction executes only sections indicated as successful - all of them in
case of a `success` status, or only indicated sections (always including guaranteed one) in case of `partial success`
status. Dust spends are treated as part of guaranteed section while Dust registrations are treated as part of intent's
fallible section.

##### Steps to apply shielded offer of a section

1. Update coin commitment tree with commitments of outputs and transients present in the offer
2. Verify obtained coin commitment tree root against provided one, implementation needs to revert updates to coin
   commitment tree and abort in case of inconsistency
3. Book coins, whose nullifiers match the ones present in offer inputs
4. Watch for received coins, for each output:
   1. Match commitment with a set of pending coins, if there is a match, mark the matching pending coin as confirmed
   2. If commitment is not a match, try to decrypt output ciphertext, if decryption succeeds - add coin to known set as
      a confirmed one
   3. If decryption fails - ignore output

##### Steps to apply unshielded offer of a section

1. Book coins spent in the inputs. Find matching Dust generation infos and set their spent time to timestamp provided
2. Filter outputs to narrow them down to only ones received by tracked addresses, for each one:
   1. Match the coin with pending ones, if there is a match, mark the matching pending coin as confirmed.
   2. Otherwise, add a coin to the known set as a confirmed.
   3. Add a new Dust generation info to the own set, if the receiving Night address was earlier registered for Dust
      generation, resolve its index in the Dust generation info Merkle tree
   4. derive the first Dust output in the chain and add it to the set of own ones as confirmed

##### Steps to apply dust actions

1. Update Dust generation tree with provided data, check its consistency
2. Update Dust commitments tree with spends present in the actions
3. Verify Dust commitments tree against root received, implementation needs to revert updates to the tree and abort in
   case of inconsistency.
4. Book Dust outputs whose nullifiers match the ones present in Dust spends, compute new Dust outputs based on the
   spends, add them to the set of own ones as confirmed

If transaction is reported to fail and is present in pending pool, it is up to implementor to choose how to progress. It
is advised to discard such transaction (with operation `discard_transaction`) and notify user.

If the transaction history is tracked and the transaction is found relevant to the history of the wallet (e.g. spends or
outputs tokens from/to wallet keys), an entry should be added, with confirmed status. The amount of shielded tokens
spent can be deducted by comparing coins provided as inputs through nullifiers and discovered outputs. Additionally,
transients present in a transaction should be inspected for transaction history completeness, as there may be tokens
immediately spent.

#### `apply_system_transaction`

Allows to discover cNight-based generation.

1. If transaction is registering cNight to generate Dust and the Dust address is own:
   1. Add the generation info to set of own ones
   2. Compute first Dust output in the chain and add it to the set of own ones as confirmed
2. If transaction is for registering backing cNight UTxO spent, and it was used to generate own Dust:
   1. Set proper timestamp on relevant generation info
3. Otherwise, ignore it

#### `finalize_transaction`

Marks transaction as final. Midnight uses Grandpa finalization gadget, which provide definitive information about
finalization, thus there is no need to implement probabilistic rules. It is expected that wallet state has already
applied provided transaction. This operation needs to:

1. Mark the Merkle trees states from that transaction as final.
2. Update status of known coins and outputs to final, so that they become part of available balance
3. Update statuses of transactions in history if tracked

#### `rollback_last_transaction`

Reverts effects of applying last transaction in response to chain reorganization.

It needs to:

1. Revert Merkle trees states to the ones from before that transaction
2. If transaction is considered own:
   1. Add it to the pool of pending transactions, so it can be submitted to the network again
   2. Move shielded coins, unshielded coins and Dust outputs received in it to pending state
   3. Restore coins spent in the transaction in a booked state
   4. Undo setting timestamp on Dust generation info related to Night UTxOs spent in the transaction
   5. Remove related Dust generation info
3. Otherwise, discard transaction

There are a couple of practical considerations:

- usage of persistent data structures will allow coin commitment tree revert to be as simple as picking an older pointer
- depending on the APIs for providing blockchain data slightly different input to this operation might be needed for a
  more efficient implementation; in all cases though handling reorganization is conceptually similar - first find
  relevant range of blocks/transactions to revert, then revert them and then apply new updates

#### `discard_transaction`

Frees resources related to tracking a transaction considered not relevant anymore due to a reorganization or wallet
giving up on submitting one. Following steps need to be taken:

1. Move transaction to transaction history as failed
2. Remove coins received in the transaction
3. Un-book coins spent in the transaction
4. Remove related Dust generation info

#### `spend`

Spend coins in a transaction, either by initiating swap, making transfer or balancing other transaction. Only final
coins should be provided as inputs to the transaction.

In certain situations implementation might allow to use confirmed and yet not final coins. Such transaction is bound to
fail in case of reorganization because of coin commitment tree root mismatch, so a special care should be put into user
experience of managing such transactions.

Following steps need to be taken, from perspective of wallet state:

1. Select coins to use in transaction and book them
2. Prepare change outputs, add them to pending coin pool
3. Prepare transaction, add it to pending transaction pool

#### `watch_for`

Watches for a coin whose details are provided. There are limitations, which require usage of this operation to receive
coins from contracts.

It only adds a coin to a pending set, if transaction details are provided too, then such transaction might be added to
transaction history with "expected" status.

Note: in many cases such transaction would be requested to be balanced, in such case the final transaction should only
be added as pending one.

## Synchronization process

Literal implementation of a Midnight Wallet, applying transactions one by one, provided by a local node is the best
option from security and privacy standpoint, but resources needed to run such implementation and time to have wallet
synchronized are quite significant. Such option requires only a stream of blocks from a node, perform basic consistency
checks and run `apply_transaction` one by one (alternatively batch all transactions from a block).

An alternative idea is to use an indexing service, at the cost of having to trust said service. In the most simplistic
approach such a service could stream all transactions to the client, but the time and resources needed by wallet would
essentially be the same as when synchronizing with a node. Below we draft alternative approaches for shielded and
unshielded tokens.

### Indexing service for shielded tokens

The service receives wallet's encryption secret key. Then the service uses it to scan for transactions relevant for
particular wallet (in this context a relevant transaction is one containing an output that can be decrypted with the key
provided) and provides data needed to evolve the state, that is:

- The necessary updates to coin commitment tree (including roots for consistency checks) - that is either commitments
  themselves or subtrees of the coin commitment tree collapsed to only relevant nodes in the tree
- Filtered transactions to apply Such service cannot spend coins because it does not have access to the coin secret key.
  It still needs to be trusted by the user though, because it has access to otherwise private information. The upside is
  that it can offer better synchronization time, less resource consumption on the user side, and overall better user
  experience.

### Indexing service for unshielded tokens

Because all the information needed by the wallet in the case of unshielded tokens is the list of UTxOs, augmented by
information about transactions they were created and spent at (including finalization information), the indexing service
only needs to provide an API to query (or subscribe) for a set of UTxOs relevant to a particular address and the
references to creation/spend transactions.

### Indexing service for Dust

The relationship between Night and Dust, as well as the need to track both generation info and spends makes the amount
of data and overall process more involved. Proposed approach would allow wallet to obtain data needed to issue Dust
spends, while having a way to limit Indexer's ability to link transactions belonging to single wallet.

To enable that, the indexer service needs to provide 4 endpoints:

1. Allowing wallet to reconstruct all generation info - while the Night part of the wallet can inform generations
   originating from mNIGHT, there are still cNIGHT ones. One possibility is to expose an endpoint allowing to learn
   about all generation by Dust address, while other would be to enable querying (or streaming) standard and system
   transactions by relevance to a Dust address.
2. Streaming collapsed updates to generation Merkle tree, including only paths relevant for own generation infos,
   starting from a provided index (which can be overlapping with the tree view held by wallet). This stream can be
   combined with the former endpoint, similarly to how it is done for shielded tokens.
3. Providing all transactions containing Dust spends with nullifiers starting by provided set of nullifier prefixes
   after certain block/transaction.
4. Streaming Dust commitments Merkle tree, where wallet provides starting point for the updates (possibly overlapping
   with the view wallet already has) and a set of commitment prefixes of wallet's interest.

With such endpoints, the synchronization could look like below:

1. Reconstruct generation infos and their Merkle tree by combining known generations from the wallet state and usage of
   endpoints #1 and #2. Optionally discard expired generation infos
2. Once all (active) generation infos are known, it becomes possible to inspect the chains of Dust spends to learn about
   the latest Dust outputs possible to spend for each generation. This is done iteratively:
   1. Calculate nullifiers of the successor Dust outputs in relation to currently known ones
   2. Make a query to endpoint #3, providing the computed nullifiers or their prefixes
   3. Filter the response to only relevant transactions
   4. Update Dust outputs data (book spent outputs, create new confirmed ones, etc.)
   5. Stop, once query does not return any new data.

   It is up to implementation to adjust length of prefixes provided with respect to the implementation's trust model and
   efficiency (shorter prefix will result with more data provided and improving privacy, at a cost of more data to
   transmit and process).

3. At the end, synchronize Dust commitments Merkle tree with streaming endpoint #4, providing commitments (or their
   prefixes) and one of already present indices in local view of the tree.

There are couple important considerations, mostly related to the fact, that there is a need to discover cNight-backed
Dust generations and that both generation and commitment Merkle trees need to be from within Dust grace period:

- periodically performing all steps up to reaching the latest data available will allow for simpler state management, at
  a cost of inefficiencies caused effectively by form of polling
- streams implementing all 3 steps can be running in parallel, allowing wallet to always operate on reasonably
  up-to-date data without employing any form of polling, at a cost of some synchronization needed or possibility that
  different portions of the state are in different state of completeness

## Building standard transactions

While there are structural similarities, building Midnight transaction is more involved than in most UTxO chains. The
reason for that is that wallet needs to prove to ledger being eligible to spend coins and not minting new coins without
having right to do so.

With the flexibility of standard transactions, various semantics of performed operations can be represented using this
single type:

- A regular transfer of tokens, of different types, with possibly many inputs and outputs.
- Balancing an existing transaction, that is, creating the necessary counter-offers, so that after merging them
  appropriately, a transaction reporting only fee-related imbalances is obtained.
- initiating a swap - creating a transaction (usually containing some inputs of token A and some outputs of token B),
  which is purposefully not balanced, to let another party balance such transaction and in that way - exchange tokens

Technically, building a standard transaction by wallet involves following operations:

- Creating shielded/unshielded inputs
- Creating shielded/unshielded outputs
- Creating transients (only shielded)
- Combining inputs and outputs into an offer
- Replacing shielded output with a transient in a shielded offer
- Creating a Dust spend
- Creating an intent
- Creating a transaction with an intent
- Merging with other transaction

A structured process for building transactions like mentioned above generally can be done in 2 steps:

1. Prepare/retrieve transactions with necessary inputs and outputs, which drive the outcome - whether it is a regular
   transfer, contract call or a swap (or a mix of them)
2. Balance the transaction obtained in step #1 - to ensure fees are paid and inputs and outputs match the desired
   structure (most importantly - that necessary change outputs are created)

Following subsections define the steps needed to perform particular operation of prepare part of transaction.

### Building operations

#### Building a shielded input

Building an input requires information, which coin owned by wallet should be provided, additionally access to part of
wallet state is needed - the coin secret key and coin commitment Merkle tree. Steps to follow are:

1. calculate nullifier
2. sample randomness
3. calculate value commitment
4. calculate Merkle proof of the coin
5. generate zero-knowledge proof using coin spending key, coin, randomness and Merkle proof
6. return randomness and the input (nullifier, value commitment, root of coin commitment tree, zero-knowledge proof)

#### Building a shielded output

Building an output requires information of an address to receive tokens, their type and amount. Steps to follow are:

1. sample new nonce
2. calculate coin commitment
3. sample randomness
4. calculate value commitment
5. encrypt output using recipient's public encryption key
6. generate zero-knowledge proof using coin public key or recipient, new coin's type, amount and nonce and randomness
7. return randomness and the output (coin commitment, value commitment, output ciphertext, zero-knowledge proof,
   contract address if contract is recipient)

#### Building a transient

Building a transient can be thought as a process of taking an output, converting it into an input, and then combining
them both into a transient. Therefore - the output is needed, its randomness, information about the coin - its type,
value and nonce, and access to part of wallet state - the coin secret key and the encryption secret key (if output
ciphertext needs to be decrypted) Steps to follow are very similar as in the case of creating input:

1. if no coin information is available - extract it by decrypting provided output ciphertext, abort if decryption fails
2. calculate nullifier
3. sample input randomness
4. calculate input value commitment
5. calculate Merkle proof of the coin - but using an empty tree with the coin commitment only
6. generate input zero-knowledge proof using coin spending key, coin, randomness and Merkle proof
7. return input randomness, output randomness and the transient containing both input data (nullifier, input value
   commitment, input zero-knowledge proof) and output data (coin commitment, output value commitment, ciphertext, output
   zero-knowledge proof, no contract address)

#### Combining shielded inputs, outputs and transients into a shielded offer

When inputs and outputs are ready, they can be combined into a Zswap offer with following steps:

1. Find and discard outputs to be replaced by transients, by comparing their coin commitments or value commitments
2. Calculate imbalances:
   1. Group inputs and outputs by token type (transients can be skipped, because they are inherently balanced)
   2. For each token type calculate imbalance as a sum of input values minus sum of output values
   3. Discard imbalances equal zero
   4. Return a map, where keys are token types, and values are their imbalances
3. Calculate binding randomness - iteratively combine randomnesses of inputs, outputs and transients (both input and
   output randomness for each)
4. Return binding randomness and the offer (inputs, outputs, imbalances)

#### Replacing shielded output with a transient

Many use-cases involving transients require replacing an existing output with a transient in an offer. Such operation
requires offer, transient, its input randomness and coin information - type and amount. The steps are:

1. Identify and remove the output to be replaced from output list, one can use output value commitment or coin
   commitment available in transient as a reference
2. Add transient to transient list, keeping the list sorted
3. Update the offer's binding randomness, by combining it with provided transient's input randomness
4. Update the offer's imbalances by increasing the imbalance for a provided coin's type by provided amount

#### Building an unshielded input

UTxO spend is almost the same as UTxO itself, with the difference that instead of an address, a verifying key is
provided — Schnorr for role `0`/`1` keys, ECDSA for role `4` keys.

While inputs/outputs is a common vocabulary for UTxO-based systems and unshielded offer has a field called inputs, the
ledger specification calls the datatype used as an input to transaction a UTxO Spend, hence mentioning both names.

#### Building an unshielded output

An unshielded output is just a minimal description of the value to transfer:

- Amount (number of indivisible units).
- Token type.
- Recipient (unshielded address).

#### Combining unshielded inputs and outputs into an unshielded offer

An unshielded offer contains a list of inputs, outputs, and signatures corresponding to inputs. The signatures sign over
the whole intent though, and, for that reason, an intermediate format needs to be used, where only inputs and outputs
are present, which allows to construct the intent.

#### Creating a Dust spend

Dust spend represents both spending and creating a new output. Creating such requires following data:

- Dust secret key to prove its ownership
- the Dust output to use
- Dust commitments Merkle tree
- current timestamp
- generation info
- generations Merkle tree
- amount of fees being paid

The steps to create a spend are following:

1. Compute nullifier of the Dust output
2. Compute commitment of the Dust output
3. Compute sequence number, nonce and commitment of the successor Dust output
4. Compute commitment's Merkle proof
5. Compute generation's Merkle proof
6. Compute spend's zero-knowledge proof by providing:
   - The Dust output that is being spent
   - The Dust secret key
   - The generation info
   - The Merkle proofs to both the Dust commitment being spent, and the generation info.
   - The sequence number and the nonce of the successor output
7. Create spend itself by including:
   - amount of fees paid
   - spent output's nullifier
   - successor output's commitment
   - spend proof

#### Creating an intent

Given:

- A non-zero segment id (zero is reserved for the guaranteed section). There are multiple approaches to obtaining one,
  with two being particularly useful in most use cases:
  - Use 1 to create an intent that will prevent front-running any actions because other intents in the transaction will
    have to use a higher number
  - Use a random number to create an intent that is expected to be merged in an arbitrary order with the other ones
    (e.g. in swaps).
- An optional guaranteed unshielded offer (unshielded offer being part of the guaranteed section).
- Optional fallible unshielded offer (unshielded offer being part of fallible section identified by segment id).
- Optional fallible shielded offer and its binding randomness.
- A list of contract actions.
- A list of Dust spends and timestamp used to create them
- A time-to-live (TTL), which is the time after which the intent is considered invalid.

An intent can be constructed as follows:

1. Construct DustAction with provided spends and timestamp
2. Establish data binding with proof-of-exponent as described in the ledger specification (Preliminaries, Fiat-Shamir'd
   and Multi-Base Pedersen), resulting in a commitment and binding randomness.
3. In each unshielded offer present, for each of its inputs provide a signature and append it to the list of signatures
   (so that when finished the number of signatures matches the number of inputs, and the keys match):
   - Over segment id and proof- and signature-erased intent.
   - Using the signing key (Schnorr for role `0`/`1` keys, ECDSA for role `4` keys) to authorize particular spend.
4. Return the segment id, intent, the fallible shielded offer and binding randomnesses for both the intent and the
   fallible shielded offer

#### Creating transaction with an intent and shielded offers

Given:

- A list of segment ids, their intents, fallible shielded offers and binding randomnesses.
- A guaranteed shielded offer and its binding randomness.

One can construct a transaction by:

1. Turning the list of segments into 2 maps:
   - A mapping from segment id to the relevant intent.
   - A mapping from segment id to a fallible zswap offer.
2. Combining all binding randomnesses into a single one (to bind transaction contents together).
3. Returning the transaction consisting of the maps from step 1, the guaranteed Zswap offer and binding randomness.

#### Merging with other transaction

Transactions can generally be merged as long as it is possible to merge guaranteed shielded offers and the segment ids
do not overlap. To do so:

1. Merge the intents map into a single one.
2. Merge the fallible shielded offers map into a single one.
3. Merge the guaranteed shielded offers as described below.
4. Combine the transaction's binding randomness.

##### Merging shielded offers

1. Verify if there are any identical inputs, outputs, or transients. Abort, if true
2. Join list of inputs from one offer, with list of inputs from the other one, sort resulting list
3. Join list of outputs from one offer, with list of outputs from the other one, sort resulting list
4. Join list of transients from one offer, with list of transients from the other one, sort resulting list
5. Join imbalances:
   1. Collect token types to include: take a sum of key sets of imbalance maps of one offer and the other one (in
      pseudocode: `offer1.imbalances.keys() ++ offer2.imbalances.keys()`)
   2. For each token type found take imbalance as a sum of imbalances from one and the other offer, defaulting to 0 if
      necessary (in pseudocode:
      `offer1.imbalances.getOrDefault(token_type, 0) + offer1.imbalances.getOrDefault(token_type, 0)`),
   3. Return new map, discarding entries, for which values are equal 0
6. Return offer containing joined inputs, outputs, transients and imbalances

### Building stages

#### Prepare transfer

Transfer transactions can be built by taking a list of desired transfers, where each one has defined the recipient's
address, token type (including information on whether it's shielded or unshielded) and the amount to be sent. Such list
can be transformed into a transaction by:

1. Creating an output for each of elements
2. Combining all the outputs into needed offers.
3. Creating a transaction skeleton from the offers, by putting them into a guaranteed section (that is - data needed to
   build the transaction, but without signatures or proofs present)

The resulting transaction will not be balanced, thus the next step of balancing the transaction (to reach 0 imbalance
for each token type) needs to be employed before the transaction is ready to be submitted to the network.

#### Prepare a swap

Swap can be thought as a specific case of a transfer - with the difference being multiple parties providing inputs and
outputs to the transaction. To prepare a swap, one needs to provide what amounts of tokens of certain types one wants to
exchange (provide as an input to the swap) for other types of tokens (receive from the swap). The transaction that
initiates the swap will be a result of:

1. Randomly choosing segment id for the unshielded intent.
2. Creating expected outputs for each of the token types to be received in the swap.
3. Combining them all into offers
4. Creating a transaction skeleton with the offers and intents, by putting them into the guaranteed section.

The resulting transaction will only have outputs to be received defined, with no inputs. Thus, the next step of
balancing the transaction must be employed before the swap offer is ready to be submitted, with proper target imbalances
indicated.

#### Contract call

Contract calls are prepared by other components than wallet. Once ready, in most cases an unbalanced transaction would
be passed to wallet in order to provide necessary inputs and pay fees in the balancing process.

#### Balance transaction

Balancing a transaction is a process of creating counter-offers, so that after merging them both, the resulting
transaction has all imbalances removed, except for DUST token, which needs to cover fees. A particular difficulty in the
process is coin selection (out of the scope of this document) and the fact that fees are growing as inputs and outputs
are added to the transaction.

Balancing in the most generic form requires 2 inputs:

1. The transaction to be balanced
2. Map of desired imbalances per token type, per segment when desired is different than zero

> [!NOTE] Balancing fallible sections will only be possible when the provided transaction is not yet bound with
> signatures and binding randomness. This does not apply to the guaranteed section because its shielded offer is not
> part of intents and all intents can include offers belonging to the guaranteed section.

Conceptually, the process follows given steps:

1. List all segments in the imbalances present, then for each segment:
   1. Create an empty offer skeleton for collecting inputs and outputs
   2. Calculate the resulting imbalances by merging ones from the unbalanced transaction, the balancing offers and
      target imbalances with values inversed (multiplied by -1)
   3. Verify if target imbalances for a segment are met:
      - If they are, the given segment has successfully assigned inputs and outputs to be balanced. Proceed to the next
        segment.
      - If they are not, continue
   4. Sort token types present in result imbalances in a way, that DUST is left last and select the first token type
   5. Perform a balancing step for the selected token type:
      - If the imbalance is positive (there is more value in inputs than outputs), create an output for self with the
        amount equal to the imbalance, and add it to the offer
      - If the imbalance is negative (there is more value in outputs than inputs), select a single coin of the selected
        type, create an input and add it to the offer; abort with error if there is no coin available to be spent
      - Go back to step 1.2
2. Cover fees, by repeating above steps for Dust:
   1. Create an empty Dust actions skeleton for capturing Dust spends and the timestamp
   2. Compute current value of all available Dust outputs
   3. Compute remaining amount of fees to be paid: sum fees needed to cover balanced transaction, the offers from
      previous step and prepared Dust spends, then subtract amount of fees provided in already prepared Dust spends.
      Continue if the remaining amount is bigger than zero, otherwise proceed to the next stage.
   4. Select Dust output to use, assign to pay with it `min(remaining_fees +  dust_spend_fee, current_value)` amount of
      fees and add it to the prepared spends
3. Once all offer and Dust spend skeletons are created, actual offers and intents can be created or adjusted:
   1. For each non-zero segment id:
      1. Create an unshielded offer with unshielded inputs and outputs from the relevant balancing offer skeleton.
      2. Merge the fallible unshielded offer with the created one
      3. Create a shielded offer with shielded inputs and outputs from the relevant balancing offer skeleton.
      4. Merge the fallible shielded offer with the created one.
   2. For zero segment id (guaranteed section):
      1. Create a shielded offer with shielded inputs and outputs from the relevant balancing offer skeleton.
      2. Create Dust actions with dust spends and the timestamp
      3. Merge the guaranteed shielded offer with the created one
      4. Create an unshielded offer with unshielded inputs and outputs from the relevant balancing offer skeleton
      5. Depending on the provided transaction status:
         - If it is bound and sealed or already contains Dust actions with a different timestamp - add a new intent
           containing the created unshielded offer as the guaranteed one and the Dust actions
         - If it is not bound and sealed yet (and likely to contain only a single intent with no Dust actions), merge
           the guaranteed unshielded offer of an intent of choice with the created one, add created Dust actions

## Transaction submission

Once transaction is created, it can be submitted to the network or other party.

For cases, where the wallet submits a transaction to the network, it is advised that the wallet implements a
re-submission mechanism. A blockchain is a distributed system and there are many possible issues, which may arise due
to, among others, networking problems such as a node being temporarily unavailable, the network being congested or a
form of eclipse attack being momentarily executed.

For example:

1. Each intent has assigned a TTL value, which is the timestamp after which a transaction cannot be included (Ledger
   also has a parameter defining a possible margin of TTL values, this is, how much ahead of `now` TTL values can be)
2. Repeatedly, in constant time intervals for each transaction present in the pending set:
   1. Find the minimal TTL value across all intents present in a transaction - let's call it transaction TTL.
   2. Compare the transaction TTL value against the wall clock time.
   3. If the transaction TTL is past the wall clock time - discard it.
   4. If the transaction TTL is not past the wall clock time yet - submit it to the network.
