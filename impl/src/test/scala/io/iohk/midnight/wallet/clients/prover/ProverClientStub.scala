package io.iohk.midnight.wallet.clients.prover

import cats.effect.SyncIO
import cats.syntax.applicative.*
import io.iohk.midnight.wallet.clients.prover.FailingProverClient.TheError
import io.iohk.midnight.wallet.clients.prover.ProverClient.ProofStatus
import io.iohk.midnight.wallet.domain.*

class ProverClientStub extends ProverClient[SyncIO] {
  override def prove(circuitValues: CircuitValues): SyncIO[ProofId] =
    ProofId("123").pure[SyncIO]

  override def proofStatus(proofId: ProofId): SyncIO[ProofStatus] =
    ProofStatus.Done(Proof("123")).pure[SyncIO]
}

class FailingProverClient extends ProverClient[SyncIO] {
  override def prove(circuitValues: CircuitValues): SyncIO[ProofId] =
    SyncIO.raiseError(TheError)

  override def proofStatus(proofId: ProofId): SyncIO[ProofStatus] =
    SyncIO.raiseError(TheError)
}

object FailingProverClient {
  val TheError = new Exception("FailingProver")
}

class AlwaysInProgressProverClient extends ProverClient[SyncIO] {
  override def prove(circuitValues: CircuitValues): SyncIO[ProofId] = ProofId("123").pure[SyncIO]
  override def proofStatus(proofId: ProofId): SyncIO[ProofStatus] =
    ProofStatus.InProgress.pure[SyncIO]
}
