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
import * as ledgerV8 from '@midnightntwrk/ledger-v8';
import * as ledgerV9 from '@midnightntwrk/ledger-v9';
import { NEVER, take } from 'rxjs';
import {
  NetworkId,
  InMemoryTransactionHistoryStorage,
  ProtocolVersion,
  WalletTransaction,
} from '@midnightntwrk/wallet-sdk-abstractions';
import { type SubmissionService } from '@midnightntwrk/wallet-sdk-capabilities';
import { TransactionLifecycleServiceImpl } from '@midnightntwrk/wallet-sdk-capabilities/transactionLifecycle';
import { DustWallet } from '@midnightntwrk/wallet-sdk-dust-wallet';
import { NodeClientError } from '@midnightntwrk/wallet-sdk-node-client/effect';
import { ShieldedWallet } from '@midnightntwrk/wallet-sdk-shielded';
import { createKeystore, PublicKey, UnshieldedWallet } from '@midnightntwrk/wallet-sdk-unshielded-wallet';
import { LedgerOps } from '@midnightntwrk/wallet-sdk-utilities';
import { Effect, Either } from 'effect';
import * as crypto from 'node:crypto';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import {
  type DefaultConfiguration,
  WalletEntrySchema,
  WalletFacade,
  isPendingWalletEntry,
  mergeWalletEntries,
} from '../src/index.js';
import { lifecycleTransactionTraits, txHistoryHash } from '../src/transaction.js';
import {
  DrivenLifecycle,
  createV8MockProvingService,
  lifecycleOf,
  nodeAnswer,
  nodeRefusal,
  nodeUnreachable,
  rejectedTxData as txData,
  serviceRejection,
} from './utils/index.js';

/** A way a submission fails, named for the table's test titles, and the rejection it produces. */
type SubmissionFailureCase = readonly [description: string, makeRejection: () => Promise<Error>];

/** The rejection of a submission a block included, which then did not reach finality in time. */
const finalityTimeout = (): Promise<Error> =>
  serviceRejection(
    new NodeClientError.TransactionProgressError({
      message: 'Transaction did not reach finality within expected time, likely consensus issues arised',
      txData,
      desiredStage: 'Finalized',
    }),
  );

/** The rejection of a submission the node reported invalid. */
const nodeReportedInvalid = (): Promise<Error> =>
  serviceRejection(new NodeClientError.TransactionInvalidError({ message: 'invalid', txData }));

/** Submission failures that prove the transaction is in no block, so nothing it booked is spent. */
const failuresProvingExclusion: ReadonlyArray<SubmissionFailureCase> = [
  [
    'the node reported it usurped',
    () => serviceRejection(new NodeClientError.TransactionUsurpedError({ message: 'usurped', txData })),
  ],
  ['the node reported it invalid', nodeReportedInvalid],
  ['the node answered the submission with a refusal', () => nodeRefusal('1010: Invalid Transaction')],
  ['no connection to the node was made, so it was never sent', () => nodeUnreachable('Could not connect')],
  [
    'the simulator discarded it',
    () => serviceRejection(new LedgerOps.LedgerError({ message: 'Transaction was discarded' })),
  ],
];

/** Submission failures that leave open whether the transaction is in a block, or show that it already is. */
const failuresNotProvingExclusion: ReadonlyArray<SubmissionFailureCase> = [
  ['it was in a block, but finality timed out', finalityTimeout],
  [
    // A pool drops a transaction from its own limits after broadcasting it, and a peer can still put it in a block.
    'the node reported it dropped from its own pool',
    () => serviceRejection(new NodeClientError.TransactionDroppedError({ message: 'dropped', txData })),
  ],
  [
    'the node answered that the transaction was recently seen and is temporarily banned',
    () => nodeAnswer(1012, '1012: Transaction is temporarily banned'),
  ],
  [
    'the node answered that its pool already holds the transaction',
    () => nodeAnswer(1013, '1013: Transaction Already Imported'),
  ],
  [
    'the submission stream ended before the transaction reached the stage',
    () =>
      serviceRejection(
        new NodeClientError.TransactionProgressError({
          message: 'Transaction did not reach desired stage and no other error was reported',
          txData,
          desiredStage: 'Finalized',
        }),
      ),
  ],
  [
    "the block number of the node's report could not be parsed",
    () => serviceRejection(new NodeClientError.ParseError({ message: 'Failed to parse result provided by node' })),
  ],
  [
    'the socket closed while the node was being handed the transaction',
    () =>
      serviceRejection(
        new NodeClientError.SubmissionError({
          message: 'Transaction submission failed',
          txData,
          cause: new Error('disconnected from ws://localhost:9944: 1006:: Abnormal Closure'),
        }),
      ),
  ],
  ['an application-supplied service failed in its own way', () => Promise.resolve(new Error('Submission failed'))],
];

/** The finalized transaction a test submits, adopted under the configuration's network. */
type SubmittedTransaction = Parameters<WalletFacade['submitTransaction']>[0];

/**
 * A facade whose submission service answers every submission with `submit`, over real wallets whose reverts are
 * watched. The facade is stopped when the test finishes, whether it passed or not.
 */
const facadeSubmittingWith = async (
  submit: () => Promise<never>,
  options: {
    txHistoryStorage?: InMemoryTransactionHistoryStorage<
      typeof WalletEntrySchema.Type,
      typeof WalletEntrySchema.Encoded
    >;
    /** Submitted in place of a mock-proved empty transaction; built for the undeployed network the facade runs on. */
    transaction?: SubmittedTransaction;
    /** Builds the lifecycle service in place of the default one, as an application restoring its records does. */
    transactionLifecycleService?: Parameters<typeof WalletFacade.init>[0]['transactionLifecycleService'];
  } = {},
) => {
  const txHistoryStorage =
    options.txHistoryStorage ?? new InMemoryTransactionHistoryStorage(WalletEntrySchema, mergeWalletEntries);
  const config = {
    networkId: NetworkId.NetworkId.Undeployed,
    forks: ProtocolVersion.V9NativeForkSchedule,
    relayURL: new URL('http://localhost:9944'),
    indexerClientConnection: { indexerHttpUrl: 'http://localhost:8080' },
    provingServerUrl: new URL('http://localhost:6300'),
    costParameters: { feeBlocksMargin: 0 },
    txHistoryStorage,
  };
  const seed = crypto.randomBytes(32);
  const shielded = await ShieldedWallet(config).startWithSeed(seed);
  const unshielded = await UnshieldedWallet(config).startWithPublicKey(
    PublicKey.fromKeyStore(createKeystore({ kind: 'schnorr', secret: seed }, config.networkId)),
  );
  const dust = await DustWallet(config).startWithSeed(seed, ledgerV9.LedgerParameters.initialParameters().dust);
  const submissionService = new (class implements SubmissionService<ledgerV9.FinalizedTransaction> {
    submitTransaction = submit;
    close = () => Promise.resolve();
  })();
  const facade = await WalletFacade.init({
    configuration: config,
    shielded: () => shielded,
    unshielded: () => unshielded,
    dust: () => dust,
    provingService: () => createV8MockProvingService(),
    submissionService: () => submissionService,
    ...(options.transactionLifecycleService
      ? { transactionLifecycleService: options.transactionLifecycleService }
      : {}),
  });
  onTestFinished(() => facade.stop());
  const reverts = [
    vi.spyOn(shielded, 'revertTransaction'),
    vi.spyOn(unshielded, 'revertTransaction'),
    vi.spyOn(dust, 'revertTransaction'),
  ] as const;
  const transaction =
    options.transaction ??
    WalletTransaction.adopt(
      'Finalized',
      ledgerV8.Transaction.fromParts(
        config.networkId,
        undefined,
        undefined,
        ledgerV8.Intent.new(new Date(Date.now() + 1000)),
      )
        .mockProve()
        .bind(),
      ProtocolVersion.MinSupportedVersion,
    );
  return { facade, reverts, transaction, txHistoryStorage };
};

/** A facade whose submission service rejects every submission with `rejection`; see {@link facadeSubmittingWith}. */
const facadeRejectingSubmissionWith = (rejection: Error, options: Parameters<typeof facadeSubmittingWith>[1] = {}) =>
  facadeSubmittingWith(() => Promise.reject(rejection), options);

/** The state of every lifecycle record the facade holds, in order. */
const recordStatesOf = async (facade: WalletFacade) =>
  (await Effect.runPromise(lifecycleOf(facade))).records.map((record) => record.state._tag);

/** A submission service's answers: the first submission is accepted, every later one rejects with `rejection`. */
const acceptedThenRejecting = (rejection: Error) =>
  vi
    .fn<() => Promise<never>>()
    // Type cast required because: the facade reads nothing from the event a submission resolves with, and no one
    // value satisfies every overload of the service's method.
    .mockResolvedValueOnce(undefined as never)
    .mockRejectedValue(rejection);

/**
 * A lifecycle whose records are read as they stand whenever asked, but whose changes reach no standing subscriber, as
 * when a move lands before the service publishes it.
 */
class UnpublishedLifecycle extends DrivenLifecycle {
  override state() {
    return this.states.pipe(take(1));
  }
}

/** Restores the lifecycle records `stored`, with the facade's own traits and clock, as an application does at start. */
const restoring =
  (stored: string): NonNullable<Parameters<typeof facadeSubmittingWith>[1]>['transactionLifecycleService'] =>
  (config, { clock }) =>
    TransactionLifecycleServiceImpl.restore(stored, lifecycleTransactionTraits(config.forks.v9), config, clock);

/** A facade that submitted its transaction and saw finality time out, so its record is Submitted when it stops. */
const submittedBeforeRestart = async () => {
  const timeout = await finalityTimeout();
  const before = await facadeRejectingSubmissionWith(timeout);
  await expect(before.facade.submitTransaction(before.transaction)).rejects.toBe(timeout);
  return before;
};

/** Refusals a node gives a fresh send, and also one it gives a transaction a block already holds. */
const restartRefusals: ReadonlyArray<SubmissionFailureCase> = [
  ['the pool refused it', () => nodeRefusal('1010: Invalid Transaction')],
  ['the node reported it invalid', nodeReportedInvalid],
];

/** Ways a submitted record ends while its send still awaits the node; each releases its bookings and records it. */
const endsDuringSend: ReadonlyArray<readonly [description: string, end: (lifecycle: DrivenLifecycle) => void]> = [
  ['was rejected by the chain', (lifecycle) => lifecycle.verdict({ status: 'FAILURE', segments: [] })],
  ['was rejected at its TTL', (lifecycle) => lifecycle.verdict({ status: 'TTL_PASSED' })],
  [
    'was orphaned by a fork',
    (lifecycle) => lifecycle.orphaned(ProtocolVersion.MinSupportedVersion, ProtocolVersion.V9NativeForkVersion),
  ],
];

/** Ways a submitted record ends, and the history status that end leaves once the facade has reacted to it. */
const recordEnds: ReadonlyArray<
  readonly [description: string, end: (lifecycle: DrivenLifecycle) => void, historyStatus: string]
> = [
  ['expired', (lifecycle) => lifecycle.expired(), 'pending'],
  ['was rejected as a failure', (lifecycle) => lifecycle.verdict({ status: 'FAILURE', segments: [] }), 'rejected'],
  [
    'was rejected as a partial success, which a block holds',
    (lifecycle) =>
      lifecycle.verdict({
        status: 'PARTIAL_SUCCESS',
        segments: [
          { id: 0, success: true },
          { id: 1, success: false },
        ],
      }),
    'rejected',
  ],
  [
    'was orphaned by a fork',
    (lifecycle) => lifecycle.orphaned(ProtocolVersion.MinSupportedVersion, ProtocolVersion.V9NativeForkVersion),
    'rejected',
  ],
];

describe('Facade submission failures', () => {
  it.each(failuresProvingExclusion)(
    'should release everything the transaction booked when %s, because no block spent it',
    async (_, makeRejection) => {
      const rejection = await makeRejection();
      const { facade, reverts, transaction, txHistoryStorage } = await facadeRejectingSubmissionWith(rejection);

      await expect(facade.submitTransaction(transaction)).rejects.toBe(rejection);

      reverts.forEach((revert) => expect(revert).toHaveBeenCalledWith(transaction));
      expect(await recordStatesOf(facade)).toStrictEqual(['Reverted']);
      const entries = await txHistoryStorage.getAll();
      expect(entries.map((entry) => entry.lifecycle.status)).toStrictEqual(['rejected']);
    },
  );

  it.each(failuresNotProvingExclusion)(
    'should keep everything the transaction booked when %s, because a block may have spent it',
    async (_, makeRejection) => {
      const rejection = await makeRejection();
      const { facade, reverts, transaction, txHistoryStorage } = await facadeRejectingSubmissionWith(rejection);

      await expect(facade.submitTransaction(transaction)).rejects.toBe(rejection);

      reverts.forEach((revert) => expect(revert).not.toHaveBeenCalled());
      expect(await recordStatesOf(facade)).toStrictEqual(['Submitted']);
      const entries = await txHistoryStorage.getAll();
      expect(entries.map(isPendingWalletEntry)).toStrictEqual([true]);
    },
  );

  it('should keep everything the transaction booked when a retry fails in a way that proves exclusion, because an earlier attempt may be in a block', async () => {
    const rejections = [
      await finalityTimeout(),
      await nodeUnreachable('Could not connect'),
      await nodeReportedInvalid(),
      await nodeRefusal('1010: Invalid Transaction'),
    ];
    const submit = rejections.reduce(
      (answers, rejection) => answers.mockRejectedValueOnce(rejection),
      vi.fn<() => Promise<never>>(),
    );
    const { facade, reverts, transaction, txHistoryStorage } = await facadeSubmittingWith(submit);

    await expect(facade.submitTransaction(transaction)).rejects.toBe(rejections[0]);
    await expect(facade.submitTransaction(transaction)).rejects.toBe(rejections[1]);
    await expect(facade.submitTransaction(transaction)).rejects.toBe(rejections[2]);
    await expect(facade.submitTransaction(transaction)).rejects.toBe(rejections[3]);

    reverts.forEach((revert) => expect(revert).not.toHaveBeenCalled());
    expect(await recordStatesOf(facade)).toStrictEqual(['Submitted']);
    const entries = await txHistoryStorage.getAll();
    expect(entries.map(isPendingWalletEntry)).toStrictEqual([true]);
  });

  it('should keep everything the transaction booked when a submission fails while another of the same transaction is in flight, because that one may reach a block', async () => {
    const unreachable = await nodeUnreachable('Could not connect');
    const firstAttempt = Promise.withResolvers<never>();
    // The first attempt answers only when the test says; the second is handed to the node and never answered.
    const submit = vi
      .fn<() => Promise<never>>()
      .mockReturnValueOnce(firstAttempt.promise)
      .mockReturnValue(new Promise<never>(() => undefined));
    const { facade, reverts, transaction, txHistoryStorage } = await facadeSubmittingWith(submit);

    const firstSubmission = facade.submitTransaction(transaction);
    void facade.submitTransaction(transaction);
    await vi.waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
    firstAttempt.reject(unreachable);

    await expect(firstSubmission).rejects.toBe(unreachable);
    reverts.forEach((revert) => expect(revert).not.toHaveBeenCalled());
    expect(await recordStatesOf(facade)).toStrictEqual(['Submitted']);
    const entries = await txHistoryStorage.getAll();
    expect(entries.map(isPendingWalletEntry)).toStrictEqual([true]);
  });

  it('should keep everything the transaction booked when a retry after an accepted submission is refused, because the accepted one is in a block', async () => {
    const invalid = await nodeReportedInvalid();
    // The first attempt is accepted; the retry is refused, as a node refuses a transaction already applied.
    const { facade, reverts, transaction } = await facadeSubmittingWith(acceptedThenRejecting(invalid));

    await facade.submitTransaction(transaction);
    await expect(facade.submitTransaction(transaction)).rejects.toBe(invalid);

    reverts.forEach((revert) => expect(revert).not.toHaveBeenCalled());
    expect(await recordStatesOf(facade)).toStrictEqual(['Submitted']);
  });

  it('should keep the resend pending and release nothing again when it is refused after the application reverted an undetermined attempt, because the revert already released its bookings', async () => {
    const [timeout, invalid] = [await finalityTimeout(), await nodeReportedInvalid()];
    const { facade, reverts, transaction, txHistoryStorage } = await facadeSubmittingWith(
      vi.fn<() => Promise<never>>().mockRejectedValueOnce(timeout).mockRejectedValueOnce(invalid),
    );
    await expect(facade.submitTransaction(transaction)).rejects.toBe(timeout);
    await facade.revert(transaction);
    expect(await recordStatesOf(facade)).toStrictEqual(['Reverted']);
    reverts.forEach((revert) => revert.mockClear());

    await expect(facade.submitTransaction(transaction)).rejects.toBe(invalid);

    reverts.forEach((revert) => expect(revert).not.toHaveBeenCalled());
    expect(await recordStatesOf(facade)).toStrictEqual(['Submitted']);
    expect((await txHistoryStorage.getAll()).map(isPendingWalletEntry)).toStrictEqual([true]);
  });

  it('should keep the resend pending and release nothing again when it is refused after the application reverted an accepted attempt, because the revert already released its bookings', async () => {
    const invalid = await nodeReportedInvalid();
    const { facade, reverts, transaction, txHistoryStorage } = await facadeSubmittingWith(
      acceptedThenRejecting(invalid),
    );
    await facade.submitTransaction(transaction);
    await facade.revert(transaction);
    reverts.forEach((revert) => revert.mockClear());

    await expect(facade.submitTransaction(transaction)).rejects.toBe(invalid);

    reverts.forEach((revert) => expect(revert).not.toHaveBeenCalled());
    expect(await recordStatesOf(facade)).toStrictEqual(['Submitted']);
    expect((await txHistoryStorage.getAll()).map(isPendingWalletEntry)).toStrictEqual([true]);
  });

  it('should keep the resend pending and release nothing again when it is refused after a revert the lifecycle has not yet published, because the record it holds says the revert released its bookings', async () => {
    const [timeout, refusal] = [await finalityTimeout(), await nodeRefusal('1010: Invalid Transaction')];
    const { facade, reverts, transaction, txHistoryStorage } = await facadeSubmittingWith(
      vi.fn<() => Promise<never>>().mockRejectedValueOnce(timeout).mockRejectedValueOnce(refusal),
      { transactionLifecycleService: () => new UnpublishedLifecycle() },
    );
    await expect(facade.submitTransaction(transaction)).rejects.toBe(timeout);
    await facade.revert(transaction);
    reverts.forEach((revert) => revert.mockClear());

    await expect(facade.submitTransaction(transaction)).rejects.toBe(refusal);

    reverts.forEach((revert) => expect(revert).not.toHaveBeenCalled());
    expect(await recordStatesOf(facade)).toStrictEqual(['Submitted']);
    expect((await txHistoryStorage.getAll()).map(isPendingWalletEntry)).toStrictEqual([true]);
  });

  it.each(endsDuringSend)(
    'should release nothing again when the only send is refused after its record %s while the send awaited the node, because that end already settled the bookings',
    async (_, end) => {
      const refusal = await nodeRefusal('1010: Invalid Transaction');
      const heldSend = Promise.withResolvers<never>();
      const lifecycle = new DrivenLifecycle();
      const { facade, reverts, transaction, txHistoryStorage } = await facadeSubmittingWith(
        vi.fn<() => Promise<never>>().mockReturnValueOnce(heldSend.promise),
        { transactionLifecycleService: () => lifecycle },
      );
      const submission = facade.submitTransaction(transaction);
      await vi.waitFor(async () => expect(await recordStatesOf(facade)).toStrictEqual(['Submitted']));
      end(lifecycle);
      await vi.waitFor(async () =>
        expect((await txHistoryStorage.getAll()).map((entry) => entry.lifecycle.status)).toStrictEqual(['rejected']),
      );
      reverts.forEach((revert) => revert.mockClear());
      const gotRejected = vi.spyOn(txHistoryStorage, 'gotRejected');

      heldSend.reject(refusal);

      await expect(submission).rejects.toBe(refusal);
      reverts.forEach((revert) => expect(revert).not.toHaveBeenCalled());
      expect(gotRejected).not.toHaveBeenCalled();
    },
  );

  it('should release nothing when a send is refused after the transaction’s TTL passed, because the sweeps at the TTL own its bookings', async () => {
    const refusal = await nodeRefusal('1010: Invalid Transaction');
    const { facade, reverts, transaction } = await facadeRejectingSubmissionWith(refusal, {
      transaction: WalletTransaction.adopt(
        'Finalized',
        ledgerV8.Transaction.fromParts(
          NetworkId.NetworkId.Undeployed,
          undefined,
          undefined,
          ledgerV8.Intent.new(new Date(Date.now() - 60_000)),
        )
          .mockProve()
          .bind(),
        ProtocolVersion.MinSupportedVersion,
      ),
      // No record says how an earlier send ended: the sweep drops a record once its TTL has passed.
      transactionLifecycleService: () => new DrivenLifecycle(),
    });

    await expect(facade.submitTransaction(transaction)).rejects.toBe(refusal);

    reverts.forEach((revert) => expect(revert).not.toHaveBeenCalled());
  });

  it('should keep everything the transaction booked when recording a retry fails before it is sent, because an earlier attempt may be in a block', async () => {
    const timeout = await finalityTimeout();
    const storageFull = new Error('the history storage is full');
    const { facade, reverts, transaction, txHistoryStorage } = await facadeSubmittingWith(
      vi.fn<() => Promise<never>>().mockRejectedValueOnce(timeout),
    );
    await expect(facade.submitTransaction(transaction)).rejects.toBe(timeout);
    vi.spyOn(txHistoryStorage, 'gotPending').mockRejectedValueOnce(storageFull);

    await expect(facade.submitTransaction(transaction)).rejects.toBe(storageFull);

    reverts.forEach((revert) => expect(revert).not.toHaveBeenCalled());
    expect(await recordStatesOf(facade)).toStrictEqual(['Submitted']);
  });

  it.each(restartRefusals)(
    'should keep everything the transaction booked when a send after a restart is refused because %s, because the attempt recorded before the restart may be in a block',
    async (_, makeRejection) => {
      const rejection = await makeRejection();
      const before = await submittedBeforeRestart();
      const { facade, reverts, transaction, txHistoryStorage } = await facadeRejectingSubmissionWith(rejection, {
        transaction: before.transaction,
        txHistoryStorage: before.txHistoryStorage,
        transactionLifecycleService: restoring(await before.facade.transactionLifecycleService.serializeState()),
      });

      await expect(facade.submitTransaction(transaction)).rejects.toBe(rejection);

      reverts.forEach((revert) => expect(revert).not.toHaveBeenCalled());
      expect(await recordStatesOf(facade)).toStrictEqual(['Submitted']);
      expect((await txHistoryStorage.getAll()).map(isPendingWalletEntry)).toStrictEqual([true]);
    },
  );

  it('should keep everything the transaction booked when recording a send after a restart fails, because the attempt recorded before the restart may be in a block', async () => {
    const storageFull = new Error('the history storage is full');
    const before = await submittedBeforeRestart();
    const { facade, reverts, transaction, txHistoryStorage } = await facadeSubmittingWith(
      () => new Promise<never>(() => undefined),
      {
        transaction: before.transaction,
        txHistoryStorage: before.txHistoryStorage,
        transactionLifecycleService: restoring(await before.facade.transactionLifecycleService.serializeState()),
      },
    );
    vi.spyOn(txHistoryStorage, 'gotPending').mockRejectedValueOnce(storageFull);

    await expect(facade.submitTransaction(transaction)).rejects.toBe(storageFull);

    reverts.forEach((revert) => expect(revert).not.toHaveBeenCalled());
    expect(await recordStatesOf(facade)).toStrictEqual(['Submitted']);
    expect((await txHistoryStorage.getAll()).map(isPendingWalletEntry)).toStrictEqual([true]);
  });

  it('should keep everything the transaction booked when a send after a restart is refused and its record is confirmed, because a block holds it', async () => {
    const refusal = await nodeRefusal('1010: Invalid Transaction');
    const before = await submittedBeforeRestart();
    const [record] = (await Effect.runPromise(lifecycleOf(before.facade))).records;
    await before.facade.transactionLifecycleService.included(record.identifiers, { status: 'SUCCESS' });
    const { facade, reverts, transaction } = await facadeRejectingSubmissionWith(refusal, {
      transaction: before.transaction,
      txHistoryStorage: before.txHistoryStorage,
      transactionLifecycleService: restoring(await before.facade.transactionLifecycleService.serializeState()),
    });

    await expect(facade.submitTransaction(transaction)).rejects.toBe(refusal);

    reverts.forEach((revert) => expect(revert).not.toHaveBeenCalled());
    expect(await recordStatesOf(facade)).toStrictEqual(['Confirmed']);
  });

  it.each(recordEnds)(
    'should release nothing again when a retry is refused after the record %s, because its end already settled the bookings',
    async (_, end, historyStatus) => {
      const [timeout, refusal] = [await finalityTimeout(), await nodeRefusal('1010: Invalid Transaction')];
      const lifecycle = new DrivenLifecycle();
      const { facade, reverts, transaction, txHistoryStorage } = await facadeSubmittingWith(
        vi.fn<() => Promise<never>>().mockRejectedValueOnce(timeout).mockRejectedValueOnce(refusal),
        { transactionLifecycleService: () => lifecycle },
      );
      await expect(facade.submitTransaction(transaction)).rejects.toBe(timeout);
      end(lifecycle);
      await vi.waitFor(async () =>
        expect((await txHistoryStorage.getAll()).map((entry) => entry.lifecycle.status)).toStrictEqual([historyStatus]),
      );
      reverts.forEach((revert) => revert.mockClear());
      const gotRejected = vi.spyOn(txHistoryStorage, 'gotRejected');

      await expect(facade.submitTransaction(transaction)).rejects.toBe(refusal);

      reverts.forEach((revert) => expect(revert).not.toHaveBeenCalled());
      expect(gotRejected).not.toHaveBeenCalled();
    },
  );

  it('should release nothing when a send that joined one still in flight is refused after the record ended, because that end already settled the bookings', async () => {
    const refusal = await nodeRefusal('1010: Invalid Transaction');
    const firstAttempt = Promise.withResolvers<never>();
    const lifecycle = new DrivenLifecycle();
    const { facade, reverts, transaction, txHistoryStorage } = await facadeSubmittingWith(
      vi.fn<() => Promise<never>>().mockReturnValueOnce(firstAttempt.promise).mockRejectedValueOnce(refusal),
      { transactionLifecycleService: () => lifecycle },
    );
    const first = facade.submitTransaction(transaction);
    await vi.waitFor(async () => expect(await recordStatesOf(facade)).toStrictEqual(['Submitted']));
    lifecycle.verdict({ status: 'FAILURE', segments: [] });
    await vi.waitFor(async () =>
      expect((await txHistoryStorage.getAll()).map((entry) => entry.lifecycle.status)).toStrictEqual(['rejected']),
    );
    reverts.forEach((revert) => revert.mockClear());

    await expect(facade.submitTransaction(transaction)).rejects.toBe(refusal);
    firstAttempt.reject(refusal);
    await expect(first).rejects.toBe(refusal);

    reverts.forEach((revert) => expect(revert).not.toHaveBeenCalled());
  });

  it('should release everything the transaction booked when recording it fails before it is sent, because no block can hold a transaction never sent', async () => {
    const storageFull = new Error('the history storage is full');
    const txHistoryStorage = Object.assign(
      new InMemoryTransactionHistoryStorage(WalletEntrySchema, mergeWalletEntries),
      {
        gotPending: () => Promise.reject(storageFull),
      },
    );
    const submit = vi.fn<() => Promise<never>>(() => new Promise<never>(() => undefined));
    const { facade, reverts, transaction } = await facadeSubmittingWith(submit, { txHistoryStorage });

    await expect(facade.submitTransaction(transaction)).rejects.toBe(storageFull);

    expect(submit).not.toHaveBeenCalled();
    reverts.forEach((revert) => expect(revert).toHaveBeenCalledWith(transaction));
    expect(await recordStatesOf(facade)).toStrictEqual(['Reverted']);
  });

  it('should reject with the submission error and every release failure when releasing after a proven refusal fails, because neither may be lost', async () => {
    const refusal = await nodeRefusal('1010: Invalid Transaction');
    const releaseFailure = new Error('the shielded wallet could not release its coins');
    const {
      facade,
      reverts: [shieldedRevert, unshieldedRevert, dustRevert],
      transaction,
      txHistoryStorage,
    } = await facadeRejectingSubmissionWith(refusal);
    shieldedRevert.mockRejectedValueOnce(releaseFailure);

    const failure = await facade.submitTransaction(transaction).then(
      () => expect.unreachable('a refused submission resolved'),
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(AggregateError);
    expect(failure instanceof AggregateError ? failure.errors : []).toStrictEqual([refusal, releaseFailure]);
    expect(unshieldedRevert).toHaveBeenCalledWith(transaction);
    expect(dustRevert).toHaveBeenCalledWith(transaction);
    expect(await recordStatesOf(facade)).toStrictEqual(['Reverted']);
    expect((await txHistoryStorage.getAll()).map((entry) => entry.lifecycle.status)).toStrictEqual(['rejected']);
  });

  it('should release every wallet and name the record update when recording the release fails, because no booking remains', async () => {
    const storageFull = new Error('the history storage is full');
    const txHistoryStorage = Object.assign(
      new InMemoryTransactionHistoryStorage(WalletEntrySchema, mergeWalletEntries),
      {
        gotPending: () => Promise.reject(storageFull),
        gotRejected: () => Promise.reject(storageFull),
      },
    );
    const { facade, reverts, transaction } = await facadeSubmittingWith(() => new Promise<never>(() => undefined), {
      txHistoryStorage,
    });

    const failure = await facade.submitTransaction(transaction).then(
      () => expect.unreachable('a submission that was never sent resolved'),
      (error: unknown) => error,
    );

    reverts.forEach((revert) => expect(revert).toHaveBeenCalledWith(transaction));
    expect(failure).toBeInstanceOf(AggregateError);
    expect(failure instanceof AggregateError ? failure.errors : []).toStrictEqual([storageFull, storageFull]);
    expect(failure instanceof AggregateError ? failure.message : '').toMatch(/record|history/i);
    expect(failure instanceof AggregateError ? failure.message : '').not.toMatch(/booking may remain/);
  });

  it('should record the transaction as rejected in the history when recording its record as reverted fails, because each record is updated on its own', async () => {
    const refusal = await nodeRefusal('1010: Invalid Transaction');
    const recordFailure = new Error('the lifecycle store is unavailable');
    const { facade, transaction, txHistoryStorage } = await facadeRejectingSubmissionWith(refusal);
    vi.spyOn(facade.transactionLifecycleService, 'reverted').mockRejectedValueOnce(recordFailure);

    const failure = await facade.submitTransaction(transaction).then(
      () => expect.unreachable('a refused submission resolved'),
      (error: unknown) => error,
    );

    expect(failure instanceof AggregateError ? failure.errors : []).toStrictEqual([refusal, recordFailure]);
    expect((await txHistoryStorage.getAll()).map((entry) => entry.lifecycle.status)).toStrictEqual(['rejected']);
  });
});

/**
 * `vi.mockObject` does not carry accessors across, and a wallet's `state` is one. The facade watches all three wallets'
 * states to know which protocol version the chain has reached, so a double without one is not a wallet.
 */
const withRealState = <TWallet extends { state: unknown }, TMocked>(mocked: TMocked, wallet: TWallet): TMocked => {
  Object.defineProperty(mocked, 'state', { get: () => wallet.state, configurable: true });
  return mocked;
};

describe('Facade submission', () => {
  it('is gracefully closed when wallet is stopped', async () => {
    const seed = crypto.randomBytes(32);
    const fakeSubmission = new (class implements SubmissionService<ledgerV9.FinalizedTransaction> {
      #gotClosed = false;

      get gotClosed() {
        return this.#gotClosed;
      }

      submitTransaction = () => Promise.reject(new Error('This submission implementation does not submit'));
      close = () => {
        return new Promise<void>((resolve) => {
          this.#gotClosed = true;
          resolve();
        });
      };
    })();
    const configuration: DefaultConfiguration = {
      networkId: NetworkId.NetworkId.Undeployed,
      forks: ProtocolVersion.V9NativeForkSchedule,
      relayURL: new URL('http://localhost:9944'),
      indexerClientConnection: {
        indexerHttpUrl: 'http://localhost:8080',
      },
      provingServerUrl: new URL('http://localhost:6300'),
      costParameters: {
        feeBlocksMargin: 0,
      },
      txHistoryStorage: new InMemoryTransactionHistoryStorage(WalletEntrySchema, mergeWalletEntries),
    };

    const facade: WalletFacade = await WalletFacade.init({
      configuration,
      submissionService: () => fakeSubmission,
      shielded: async (config) => {
        const wallet = await ShieldedWallet(config).startWithSeed(seed);
        const mockedShielded = withRealState(vi.mockObject(wallet), wallet);
        mockedShielded.start.mockResolvedValue(undefined);
        return mockedShielded;
      },
      unshielded: async (config) => {
        const wallet = await UnshieldedWallet(config).startWithPublicKey(
          PublicKey.fromKeyStore(createKeystore({ kind: 'schnorr', secret: seed }, config.networkId)),
        );
        // The facade watches this stream for the moment sync reaches the tip; this wallet never gets there.
        const mockedUnshielded = withRealState(vi.mockObject(wallet), { state: NEVER });
        mockedUnshielded.start.mockResolvedValue(undefined);
        return mockedUnshielded;
      },
      dust: async (config) => {
        const wallet = await DustWallet(config).startWithSeed(seed, ledgerV9.LedgerParameters.initialParameters().dust);
        const mockedDust = withRealState(vi.mockObject(wallet), wallet);
        mockedDust.start.mockResolvedValue(undefined);
        return mockedDust;
      },
    });

    await facade.start({ shielded: seed, unshielded: seed, dust: seed });
    await facade.stop();

    expect(fakeSubmission.gotClosed).toBe(true);
  });

  it('should record a transaction the node refused as rejected under the key it was submitted with, because the pending entry must end in place', async () => {
    const refusal = await nodeRefusal('1010: Invalid Transaction');
    const { facade, reverts, transaction, txHistoryStorage } = await facadeRejectingSubmissionWith(refusal);

    await expect(facade.submitTransaction(transaction)).rejects.toBe(refusal);

    reverts.forEach((revert) => expect(revert).toHaveBeenCalledWith(transaction));

    // The pending entry written at submit time and the rejected entry written on revert share one key (both go through
    // `txHistoryHash`), so the failed submission leaves a single entry transitioned in place — not an orphan pair.
    const entries = await txHistoryStorage.getAll();
    expect(entries).toHaveLength(1);
    // Read through the handle, because that is now the only way to reach the transaction it names: the key is the
    // ledger transaction hash exactly as the submit and revert sides both compute it.
    expect(entries[0].hash).toBe(
      txHistoryHash(
        Either.getOrThrow(
          WalletTransaction.unwrapWithin<ledgerV8.FinalizedTransaction>(
            transaction,
            ProtocolVersion.epochOf(ProtocolVersion.MinSupportedVersion, ProtocolVersion.MinSupportedVersion),
          ),
        ),
      ),
    );
    expect(entries[0].lifecycle.status).toBe('rejected');
  });

  it('should pair submit and revert for a non-hashable (proof-erased) tx, transitioning the entry in place, because both key it by its bytes', async () => {
    // The simulator submits proof-erased transactions, whose `transactionHash()` throws — so the key falls back to the
    // serialized bytes. The runtime tx type is erased exactly as the simulator submission service does (helpers.ts),
    // which the static `FinalizedTransaction` type can't express.
    const proofErased = ledgerV8.Transaction.fromParts(
      NetworkId.NetworkId.Undeployed,
      undefined,
      undefined,
      ledgerV8.Intent.new(new Date(Date.now() + 10_000)),
    ).eraseProofs();
    expect(() => proofErased.transactionHash()).toThrow();
    const refusal = await nodeRefusal('1010: Invalid Transaction');
    // Sealed at the finalized stage because that is the stage the facade takes: what the handle carries is a
    // proof-erased transaction, which is exactly the case whose history key falls back to its bytes.
    const { facade, transaction, txHistoryStorage } = await facadeRejectingSubmissionWith(refusal, {
      transaction: WalletTransaction.adopt('Finalized', proofErased, ProtocolVersion.MinSupportedVersion),
    });

    // The input is a proof-erased transaction the node's pool refused (1010): submitTransaction writes the pending
    // entry and then reverts, both keyed off the same serialized-bytes hash, so the result is a single entry
    // transitioned in place rather than an orphan pending + orphan rejected pair.
    await expect(facade.submitTransaction(transaction)).rejects.toBe(refusal);

    const entries = await txHistoryStorage.getAll();
    expect(entries).toHaveLength(1);
    expect(entries[0].hash).toBe(Buffer.from(proofErased.serialize()).toString('hex'));
    expect(entries[0].lifecycle.status).toBe('rejected');
  });
});

describe('Facade transaction history reads return entries regardless of lifecycle', () => {
  // Regression: queryTxHistoryByHash / getAllFromTxHistory once filtered to finalized entries, hiding pending ones
  // (commits e40e65de, d19f99e0). A submitted-but-not-yet-confirmed tx must be retrievable as pending — the docker
  // e2e tests all wait until finalized, so they would not catch reintroduction of a finalized-only filter.
  it('returns a pending entry via queryTxHistoryByHash and getAllFromTxHistory', async () => {
    const txHistoryStorage = new InMemoryTransactionHistoryStorage(WalletEntrySchema, mergeWalletEntries);
    const config = {
      networkId: NetworkId.NetworkId.Undeployed,
      forks: ProtocolVersion.V9NativeForkSchedule,
      relayURL: new URL('http://localhost:9944'),
      indexerClientConnection: { indexerHttpUrl: 'http://localhost:8080' },
      provingServerUrl: new URL('http://localhost:6300'),
      costParameters: { feeBlocksMargin: 0 },
      txHistoryStorage,
    };
    const seed = crypto.randomBytes(32);
    const fakeSubmission = new (class implements SubmissionService<ledgerV9.FinalizedTransaction> {
      submitTransaction = () => Promise.reject(new Error('not used in this test'));
      close = () => Promise.resolve();
    })();
    const facade: WalletFacade = await WalletFacade.init({
      configuration: config,
      shielded: (c) => ShieldedWallet(c).startWithSeed(seed),
      unshielded: (c) =>
        UnshieldedWallet(c).startWithPublicKey(
          PublicKey.fromKeyStore(createKeystore({ kind: 'schnorr', secret: seed }, c.networkId)),
        ),
      dust: (c) => DustWallet(c).startWithSeed(seed, ledgerV9.LedgerParameters.initialParameters().dust),
      submissionService: () => fakeSubmission,
    });

    // The facade shares this storage instance, so a pending entry written here is what the reads must surface.
    await txHistoryStorage.gotPending({ hash: 'pending-tx', identifiers: ['id-1'], submittedAt: new Date(0) });

    const entry = await facade.queryTxHistoryByHash('pending-tx');
    expect(entry).toBeDefined();
    expect(isPendingWalletEntry(entry!)).toBe(true);
    expect(entry!.hash).toBe('pending-tx');

    const all = await facade.getAllFromTxHistory();
    expect(all).toHaveLength(1);
    expect(isPendingWalletEntry(all[0])).toBe(true);
  });
});
