package io.iohk.midnight.wallet.services

import cats.MonadThrow
import cats.syntax.all.*
import io.iohk.midnight.wallet.clients.prover.ProverClient
import io.iohk.midnight.wallet.clients.prover.ProverClient.ProofStatus
import io.iohk.midnight.wallet.domain.*

trait ProverService[F[_]] {
  def prove(circuitValues: CircuitValues): F[Proof]
}

object ProverService {
  class Live[F[_]: MonadThrow](proverClient: ProverClient[F], maxRetries: Int)
      extends ProverService[F] {
    override def prove(circuitValues: CircuitValues): F[Proof] =
      proverClient.prove(circuitValues).flatMap(pollForProof)

    private def pollForProof(proofId: ProofId): F[Proof] =
      (proofId, maxRetries).tailRecM((getProofStatus _).tupled)

    private def getProofStatus(
        proofId: ProofId,
        remainingRetries: Int,
    ): F[Either[(ProofId, Int), Proof]] =
      proverClient.proofStatus(proofId).flatMap {
        case ProofStatus.Done(proof) =>
          Right(proof).pure[F].widen
        case ProofStatus.InProgress if remainingRetries > 0 =>
          Left((proofId, remainingRetries - 1)).pure[F].widen
        case ProofStatus.InProgress =>
          Error.PollingForProofMaxRetriesReached.raiseError[F, Either[(ProofId, Int), Proof]]
      }
  }

  sealed trait Error extends Throwable
  object Error {
    case object PollingForProofMaxRetriesReached extends Error
  }
}
