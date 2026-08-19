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
// Signing as a service (#504). Authorizing a transaction means producing a `Signature` over each signable segment.
// For an in-process keystore that is instantaneous, but MPC (threshold protocols with network round-trips) and HSM
// (on-device PKCS#11) signers are inherently asynchronous. The signer is therefore an async callback, and the
// orchestration that invokes it lives here — in the Effect (imperative-shell) layer — while the pure transformations
// (which segments to sign, scheme validation, signature attachment) stay in `TransactionOps`.
import { EitherOps } from '@midnightntwrk/wallet-sdk-utilities';
import { Effect, pipe } from 'effect';
import type * as ledger from '@midnightntwrk/ledger-v9';
import { type SegmentSignature, TransactionOps, type UnboundTransaction } from './TransactionOps.js';
import { SignError, type WalletError } from './WalletError.js';

/**
 * Produces a {@link ledger.Signature} over the supplied bytes. Asynchronous so that out-of-process signers (MPC, HSM) —
 * whose whole purpose is that the secret never materializes in-process — can be plugged in directly. A synchronous
 * in-process keystore satisfies this by resolving immediately: `keystore.signDataAsync`.
 */
export type SignSegment = (data: Uint8Array) => Promise<ledger.Signature>;

/**
 * Authorizes a transaction by signing each of its signable segments with the supplied async {@link SignSegment}. The
 * service is the imperative shell: it drives the async signer and maps its failures into the typed error channel; the
 * pure work is delegated to {@link TransactionOps.collectSignableData} and {@link TransactionOps.attachSignatures}.
 */
export interface SigningService {
  sign<TTransaction extends ledger.UnprovenTransaction | UnboundTransaction>(
    transaction: TTransaction,
    signSegment: SignSegment,
  ): Effect.Effect<TTransaction, WalletError>;
}

/**
 * The default signing service: collect each segment's signable data (pure), invoke the async signer once per segment
 * (sequentially — segment counts are tiny), then attach the signatures (pure, with scheme validation). A signer
 * rejection or throw is wrapped in a {@link SignError}; a scheme mismatch short-circuits inside `attachSignatures`
 * before anything is attached, so no partially-signed transaction can escape.
 */
export const makeDefaultSigningService = (): SigningService => ({
  sign(transaction, signSegment) {
    return Effect.gen(function* () {
      const segments = yield* EitherOps.toEffect(TransactionOps.collectSignableData(transaction));
      const signatures = yield* Effect.forEach(segments, (segment) =>
        pipe(
          Effect.tryPromise({
            try: () => signSegment(segment.data),
            catch: (cause) => new SignError({ message: 'Signer callback failed', cause }),
          }),
          Effect.map((signature): SegmentSignature => ({ segment: segment.segment, signature })),
        ),
      );
      return yield* EitherOps.toEffect(TransactionOps.attachSignatures(transaction, signatures));
    });
  },
});
