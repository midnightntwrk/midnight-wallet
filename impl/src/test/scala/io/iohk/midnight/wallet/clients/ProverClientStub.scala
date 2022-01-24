package io.iohk.midnight.wallet.clients

import cats.effect.SyncIO
import cats.syntax.applicative.*
import io.iohk.midnight.wallet.clients.FailingProverClient.TheError
import io.iohk.midnight.wallet.clients.ProverClient.*
import io.iohk.midnight.wallet.domain.*

class ProverClientStub extends ProverClient[SyncIO]:
  override def prove(circuitValues: CircuitValues): SyncIO[ProofId] = ProofId().pure

  override def proofStatus(proofId: ProofId): SyncIO[ProofStatus] = ProofStatus.Done(Proof()).pure

class FailingProverClient extends ProverClient[SyncIO]:
  override def prove(circuitValues: CircuitValues): SyncIO[ProofId] =
    SyncIO.raiseError(TheError)

  override def proofStatus(proofId: ProofId): SyncIO[ProofStatus] =
    SyncIO.raiseError(TheError)

object FailingProverClient:
  val TheError = new Exception("FailingProver")

class AlwaysInProgressProverClient extends ProverClient[SyncIO]:
  override def prove(circuitValues: CircuitValues): SyncIO[ProofId] = ProofId().pure

  override def proofStatus(proofId: ProofId): SyncIO[ProofStatus] = ProofStatus.InProgress.pure
