package io.iohk.midnight.wallet.core.clients.prover

import cats.effect.IO
import cats.syntax.applicative.*
import io.iohk.midnight.wallet.blockchain.data.{CircuitValues, Proof, ProofId}
import io.iohk.midnight.wallet.core.clients.prover.FailingProverClient.TheError
import io.iohk.midnight.wallet.core.clients.prover.ProverClient.ProofStatus

class ProverClientStub extends ProverClient[IO] {
  override def prove(circuitValues: CircuitValues): IO[ProofId] =
    ProofId("123").pure[IO]

  override def proofStatus(proofId: ProofId): IO[ProofStatus] =
    ProofStatus.Done(Proof("123")).pure[IO]
}

class FailingProverClient extends ProverClient[IO] {
  override def prove(circuitValues: CircuitValues): IO[ProofId] =
    IO.raiseError(TheError)

  override def proofStatus(proofId: ProofId): IO[ProofStatus] =
    IO.raiseError(TheError)
}

object FailingProverClient {
  val TheError: Exception = new Exception("FailingProver")
}

class AlwaysInProgressProverClient extends ProverClient[IO] {
  override def prove(circuitValues: CircuitValues): IO[ProofId] = ProofId("123").pure[IO]
  override def proofStatus(proofId: ProofId): IO[ProofStatus] =
    ProofStatus.InProgress.pure[IO]
}
