// This file is part of MIDNIGHT-WALLET-SDK.
// Copyright (C) Midnight Foundation
// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0 (the "License");
// You may not use this file except in compliance with the License.
// You may obtain a copy of the License at
// http://www.apache.org/licenses/LICENSE-2.0
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

/**
 * How the SDK writes a signature, whichever ledger version is underneath.
 *
 * @remarks
 *   The one scalar that genuinely changed shape at the protocol boundary. Ledger-v8 has a single signature scheme and
 *   writes a signature as bare hexadecimal; ledger-v9 has more than one and names the scheme alongside the bytes.
 *   Everything else an application reads — token types, addresses, nullifiers, transaction identifiers — is
 *   byte-identical across the two.
 *
 *   The SDK speaks the ledger-v9 shape everywhere and lowers it for the V1 variant, rather than the reverse. Lifting is
 *   total — ledger-v8 has exactly one scheme, so naming it is never a guess — while lowering is partial, and a scheme
 *   ledger-v8 has never heard of is refused rather than handed over as bytes it would misread. Speaking the ledger-v8
 *   shape would have made the common case lossy instead.
 *
 *   Kept beside that lifting and lowering rather than among the abstractions a variant implements, because this is the
 *   vocabulary those two functions are stated in and nothing else in the SDK is defined against it. It names no ledger
 *   version itself, so an application can annotate a signer without importing one, and nothing on the way to it loads
 *   either ledger's WebAssembly. These are structurally ledger-v9's own types: a signer already written against them
 *   compiles unchanged.
 */

/** The signature schemes the chain knows. Only `schnorr` exists before the protocol boundary. */
export type SignatureKind = 'schnorr' | 'ecdsa';

/** A signature: the scheme that produced it, and its bytes as hexadecimal. */
export type Signature = Readonly<{ tag: SignatureKind; value: string }>;

/** The public half of a signing key, named with the scheme it belongs to. */
export type SignatureVerifyingKey = Readonly<{ tag: SignatureKind; value: string }>;

/** A signing key, named with the scheme it belongs to. */
export type SigningKey = Readonly<{ tag: SignatureKind; value: string }>;
