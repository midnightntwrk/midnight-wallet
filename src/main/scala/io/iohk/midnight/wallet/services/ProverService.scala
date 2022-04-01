package io.iohk.midnight.wallet.services

import cats.syntax.all.*
import io.iohk.midnight.wallet.clients.prover.ProverClient
import io.iohk.midnight.wallet.clients.prover.ProverClient.ProofStatus
import io.iohk.midnight.wallet.domain.*
import io.iohk.midnight.wallet.domain.ProofId
import io.iohk.midnight.wallet.domain.Proof
import cats.effect.Temporal

import scala.concurrent.duration.FiniteDuration
import io.iohk.midnight.wallet.services.ProverService.Error.PollingForProofMaxRetriesReached

trait ProverService[F[_]] {
  def prove(circuitValues: CircuitValues): F[Proof]
}

object ProverService {
  class Live[F[_]: Temporal](
      proverClient: ProverClient[F],
      maxRetries: Int,
      retryDelay: FiniteDuration,
  ) extends ProverService[F] {
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
          Right(proof).pure.widen
        case ProofStatus.InProgress if remainingRetries > 0 =>
          Temporal[F].sleep(retryDelay).as(Left((proofId, remainingRetries - 1)))
        case ProofStatus.InProgress =>
          PollingForProofMaxRetriesReached.raiseError
      }
  }

  sealed trait Error extends Throwable
  object Error {
    case object PollingForProofMaxRetriesReached extends Error
  }
}
