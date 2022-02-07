package io.iohk.midnight.wallet

import cats.MonadThrow
import cats.effect.Clock
import cats.effect.std.Random
import cats.syntax.applicative.*
import cats.syntax.applicativeError.*
import cats.syntax.flatMap.*
import cats.syntax.functor.*
import fs2.Stream
import io.iohk.midnight.wallet.Wallet.*
import io.iohk.midnight.wallet.domain.*
import io.iohk.midnight.wallet.domain.Hashing.*
import io.iohk.midnight.wallet.services.SyncService.SubmissionResponse
import io.iohk.midnight.wallet.services.{LaresService, ProverService, SyncService}
import io.iohk.midnight.wallet.util.ClockOps.*
import io.iohk.midnight.wallet.util.HashOps.*
import java.time.Instant

trait Wallet[F[_]] {
  def callContract(contractInput: CallContractInput): F[Hash[CallTransaction]]

  def deployContract(contractInput: DeployContractInput): F[Hash[DeployTransaction]]

  def sync(): F[Stream[F, Seq[SemanticEvent]]]

  def getUserId(): F[UserId]
}

object Wallet {
  class Live[F[_]: MonadThrow: Clock: Random](
      proverService: ProverService[F],
      syncService: SyncService[F],
      laresService: LaresService[F],
      userId: UserId,
  ) extends Wallet[F] {
    override def callContract(input: CallContractInput): F[Hash[CallTransaction]] =
      for {
        proof <- proverService.prove(input.circuitValues)
        timestamp <- Clock[F].realTimeInstant
        transaction = buildCallTransaction(timestamp, input, proof)
        hash <- transaction.calculateHash
        response <- syncService.submitTransaction(transaction.copy(hash = Some(hash)))
        result <- response match {
          case SubmissionResponse.Accepted         => hash.pure
          case SubmissionResponse.Rejected(reason) => TransactionRejected(reason).raiseError
        }
      } yield result

    private def buildCallTransaction(
        timestamp: Instant,
        input: CallContractInput,
        proof: Proof,
    ): CallTransaction =
      CallTransaction(
        None,
        timestamp,
        input.contractHash,
        input.transitionFunction,
        Some(proof),
        input.publicTranscript,
      )

    override def deployContract(input: DeployContractInput): F[Hash[DeployTransaction]] =
      for {
        timestamp <- Clock[F].realTimeInstant
        transaction = buildDeployTransaction(timestamp, input)
        hash <- transaction.calculateHash
        response <- syncService.submitTransaction(transaction.copy(hash = Some(hash)))
        result <- response match {
          case SubmissionResponse.Accepted         => hash.pure
          case SubmissionResponse.Rejected(reason) => TransactionRejected(reason).raiseError
        }
      } yield result

    private def buildDeployTransaction(
        timestamp: Instant,
        input: DeployContractInput,
    ): DeployTransaction =
      DeployTransaction(
        None,
        timestamp,
        input.contractSource,
        input.publicState,
        TransitionFunctionCircuits(Map.empty),
      )

    override def sync(): F[Stream[F, Seq[SemanticEvent]]] =
      syncService.sync().map(_.evalMap(laresService.applyBlock))

    override def getUserId(): F[UserId] = userId.pure
  }

  final case class CallContractInput(
      contractHash: Hash[DeployTransaction],
      publicTranscript: PublicTranscript,
      transitionFunction: TransitionFunction,
      circuitValues: CircuitValues,
  )

  final case class DeployContractInput(
      contractSource: ContractSource,
      publicState: PublicState,
  )

  sealed trait Error extends Exception
  case class TransactionRejected(reason: String) extends Error
}
