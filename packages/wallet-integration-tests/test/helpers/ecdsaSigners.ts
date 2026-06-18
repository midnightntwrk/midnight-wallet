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
//
// Test fakes for external ECDSA signer backends (MPC, HSM) and an independent
// verification oracle. These are fakes (not vi.mock): they exercise the wallet's
// integration contract — "an external backend produces a valid ledger Signature
// for the wallet's verifying key" — and the orchestration semantics around it
// (threshold, timeout, availability, auth). The cryptographic correctness of a
// real MPC/HSM product is explicitly out of scope.
import * as ledger from '@midnight-ntwrk/ledger-v9';
import { secp256k1 } from '@noble/curves/secp256k1';
import { sha256 } from '@noble/hashes/sha2';
import { randomBytes } from 'node:crypto';

const ORDER = secp256k1.Point.Fn.ORDER;
const fromHex = (hex: string): Uint8Array => Uint8Array.from(Buffer.from(hex, 'hex'));
const scalarToHex = (scalar: bigint): string => scalar.toString(16).padStart(64, '0');
const bytesToScalar = (bytes: Uint8Array): bigint => BigInt(`0x${Buffer.from(bytes).toString('hex')}`);
const mod = (value: bigint): bigint => ((value % ORDER) + ORDER) % ORDER;

/**
 * Independent ECDSA verifier (secp256k1 over `sha256(data)`, matching the ledger) implemented with `@noble/curves` — a
 * different library from the one that produced the signature, so backend signatures are never self-attested.
 */
export const verifyEcdsaWithOracle = (
  verifyingKey: ledger.SignatureVerifyingKey,
  data: Uint8Array,
  signature: ledger.Signature,
): boolean => {
  if (verifyingKey.tag !== 'ecdsa' || signature.tag !== 'ecdsa') {
    return false;
  }
  return secp256k1.verify(fromHex(signature.value), sha256(data), fromHex(verifyingKey.value));
};

// ───────────────────────────── MPC ─────────────────────────────

export class MpcThresholdError extends Error {
  readonly _tag = 'MpcThresholdError' as const;
  readonly required: number;
  readonly received: number;
  constructor(required: number, received: number) {
    super(`MPC threshold not met: need ${required} participants, got ${received}`);
    this.required = required;
    this.received = received;
  }
}

export class MpcTimeoutError extends Error {
  readonly _tag = 'MpcTimeoutError' as const;
  readonly party: number;
  constructor(party: number) {
    super(`MPC party ${party} timed out`);
    this.party = party;
  }
}

/** A participating party, optionally modelling network latency (delayMs). */
export type MpcParticipant = { readonly index: number; readonly delayMs?: number };

/**
 * Fake threshold-ECDSA coordinator. The secret scalar is split into `parties` additive shares (the "share fixtures"); a
 * signature is produced only when all shares participate (a t-of-t simplification of real t-of-n threshold ECDSA —
 * which never reconstructs the key; this fake does, since it tests orchestration, not MPC security).
 */
export class FakeMpcCoordinator {
  readonly #shares: readonly bigint[];
  readonly #threshold: number;
  readonly #publicKey: ledger.SignatureVerifyingKey;

  private constructor(shares: readonly bigint[], threshold: number, publicKey: ledger.SignatureVerifyingKey) {
    this.#shares = shares;
    this.#threshold = threshold;
    this.#publicKey = publicKey;
  }

  static fromSecret(secret: Uint8Array, parties: number): FakeMpcCoordinator {
    const secretScalar = mod(bytesToScalar(secret));
    const randomShares = Array.from({ length: parties - 1 }, () => mod(bytesToScalar(randomBytes(32))));
    const lastShare = mod(secretScalar - randomShares.reduce((acc, share) => mod(acc + share), 0n));
    const shares = [...randomShares, lastShare];
    const publicKey = ledger.signatureVerifyingKey({ tag: 'ecdsa', value: scalarToHex(secretScalar) });
    return new FakeMpcCoordinator(shares, parties, publicKey);
  }

  get publicKey(): ledger.SignatureVerifyingKey {
    return this.#publicKey;
  }

  get parties(): number {
    return this.#shares.length;
  }

  /** All parties participating, no latency — the happy-path threshold set. */
  allParticipants(): readonly MpcParticipant[] {
    return this.#shares.map((_, index) => ({ index }));
  }

  /**
   * Assemble a signature from the participating parties' shares.
   *
   * @throws MpcThresholdError if fewer than the threshold of parties participate (no signing attempted).
   * @throws MpcTimeoutError if a participating party does not respond within `timeoutMs`.
   */
  async requestSignature(
    payload: Uint8Array,
    participants: readonly MpcParticipant[],
    timeoutMs = 1_000,
  ): Promise<ledger.Signature> {
    if (participants.length < this.#threshold) {
      throw new MpcThresholdError(this.#threshold, participants.length);
    }
    const contributions = await Promise.all(participants.map((party) => this.#contribute(party, timeoutMs)));
    const reconstructed = mod(contributions.reduce((acc, share) => mod(acc + share), 0n));
    return ledger.signData({ tag: 'ecdsa', value: scalarToHex(reconstructed) }, payload);
  }

  #contribute(party: MpcParticipant, timeoutMs: number): Promise<bigint> {
    // Bounds-check the index (rather than `share === undefined`, which the element type rules out) so an unknown party
    // is still rejected without an always-false comparison.
    if (party.index < 0 || party.index >= this.#shares.length) {
      return Promise.reject(new Error(`Unknown MPC party ${party.index}`));
    }
    const share = this.#shares[party.index];
    if (party.delayMs === undefined) {
      return Promise.resolve(share);
    }
    return new Promise<bigint>((resolve, reject) => {
      // Each branch clears the other's timer, so no timer dangles once settled.
      const deliver = setTimeout(() => {
        clearTimeout(timeout);
        resolve(share);
      }, party.delayMs);
      const timeout = setTimeout(() => {
        clearTimeout(deliver);
        reject(new MpcTimeoutError(party.index));
      }, timeoutMs);
    });
  }
}

// ───────────────────────────── HSM ─────────────────────────────

export class HsmUnavailableError extends Error {
  readonly _tag = 'HsmUnavailableError' as const;
}

export class HsmAuthError extends Error {
  readonly _tag = 'HsmAuthError' as const;
}

/**
 * Fake HSM-backed signer. The signing key lives in a private field and is never exposed — only `getPublicKey()` and
 * `sign()` are public, modelling a key that never leaves the device.
 */
export class FakeHsm {
  readonly #signingKey: ledger.SigningKey;
  readonly #publicKey: ledger.SignatureVerifyingKey;
  available = true;
  authenticated = true;

  constructor(secret: Uint8Array) {
    this.#signingKey = { tag: 'ecdsa', value: Buffer.from(secret).toString('hex') };
    this.#publicKey = ledger.signatureVerifyingKey(this.#signingKey);
  }

  getPublicKey(): ledger.SignatureVerifyingKey {
    return this.#publicKey;
  }

  /**
   * @throws HsmUnavailableError if the device is unreachable.
   * @throws HsmAuthError if the session is not authenticated (distinct from unavailable).
   */
  sign(payload: Uint8Array): Promise<ledger.Signature> {
    if (!this.available) {
      return Promise.reject(new HsmUnavailableError('HSM unavailable'));
    }
    if (!this.authenticated) {
      return Promise.reject(new HsmAuthError('HSM authentication failed'));
    }
    return Promise.resolve(ledger.signData(this.#signingKey, payload));
  }
}
