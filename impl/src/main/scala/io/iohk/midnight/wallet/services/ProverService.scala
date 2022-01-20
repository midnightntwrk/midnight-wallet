package io.iohk.midnight.wallet.services

import cats.MonadThrow
import cats.syntax.applicative.*
import cats.syntax.applicativeError.*
import cats.syntax.flatMap.*
import io.iohk.midnight.wallet.clients.ProverClient
import io.iohk.midnight.wallet.domain.{CircuitValues, Proof, ProofId, ProofStatus}

trait ProverService[F[_]]:
  def prove(circuitValues: CircuitValues): F[Proof]

object ProverService:
  class Live[F[_]: MonadThrow](proverClient: ProverClient[F], maxRetries: Int)
      extends ProverService[F]:
    override def prove(circuitValues: CircuitValues): F[Proof] =
      proverClient.prove(circuitValues).flatMap(pollForProof)

    private def pollForProof(proofId: ProofId): F[Proof] =
      (proofId, maxRetries).tailRecM(getProofStatus)

    private def getProofStatus(
        proofId: ProofId,
        remainingRetries: Int,
    ): F[Either[(ProofId, Int), Proof]] =
      proverClient.proofStatus(proofId).flatMap {
        case ProofStatus.Done(proof) =>
          Right(proof).pure
        case ProofStatus.InProgress if remainingRetries > 0 =>
          Left((proofId, remainingRetries - 1)).pure
        case ProofStatus.InProgress =>
          Error.PollingForProofMaxRetriesReached.raiseError
      }

  enum Error extends Throwable:
    case PollingForProofMaxRetriesReached
