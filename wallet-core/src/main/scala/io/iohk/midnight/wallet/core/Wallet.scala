package io.iohk.midnight.wallet.core

import cats.MonadThrow
import cats.effect.Clock
import cats.effect.std.Random
import cats.syntax.all.*
import fs2.Stream
import io.iohk.midnight.wallet.blockchain.data
import io.iohk.midnight.wallet.blockchain.data.{
  CallTransaction,
  CircuitValues,
  ContractSource,
  DeployTransaction,
  Hash,
  Nonce,
  Proof,
  PublicState,
  PublicTranscript,
  TransitionFunction,
  TransitionFunctionCircuits,
}
import io.iohk.midnight.wallet.core.Wallet.{CallContractInput, DeployContractInput}
import io.iohk.midnight.wallet.core.domain.UserId
import io.iohk.midnight.wallet.core.services.TxSubmissionService.SubmissionResult
import io.iohk.midnight.wallet.core.services.{ProverService, SyncService, TxSubmissionService}
import io.iohk.midnight.wallet.core.util.ClockOps.*
import java.time.Instant

trait Wallet[F[_]] {
  def callContract(contractInput: CallContractInput): F[Hash[CallTransaction]]

  def deployContract(contractInput: DeployContractInput): F[Hash[DeployTransaction]]

  def sync(): Stream[F, Seq[Any]]

  def getUserId(): F[UserId]
}

object Wallet {
  class Live[F[_]: MonadThrow: Clock: Random](
      proverService: ProverService[F],
      submitTxService: TxSubmissionService[F],
      syncService: SyncService[F],
      userId: UserId,
  ) extends Wallet[F] {
    override def callContract(input: CallContractInput): F[Hash[CallTransaction]] =
      for {
        proof <- proverService.prove(input.circuitValues)
        timestamp <- Clock[F].realTimeInstant
        transaction = buildCallTransaction(timestamp, input, proof)
        hash <- transaction.calculateHash
        response <- submitTxService.submitTransaction(transaction.copy(hash = Some(hash)))
        result <- response match {
          case SubmissionResult.Accepted         => hash.pure
          case SubmissionResult.Rejected(reason) => TransactionRejected(reason).raiseError
        }
      } yield result

    private def buildCallTransaction(
        timestamp: Instant,
        input: CallContractInput,
        proof: Proof,
    ): CallTransaction =
      data.CallTransaction(
        None,
        input.nonce,
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
        response <- submitTxService.submitTransaction(transaction.copy(hash = Some(hash)))
        result <- response match {
          case SubmissionResult.Accepted => hash.pure
          case SubmissionResult.Rejected(reason) =>
            TransactionRejected(reason).raiseError
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

    override def sync(): Stream[F, Seq[Any]] =
      syncService.sync().map(_ => Seq.empty) // Just to keep the dependency to syncService

    override def getUserId(): F[UserId] = userId.pure
  }

  final case class CallContractInput(
      contractHash: Hash[DeployTransaction],
      nonce: Nonce,
      publicTranscript: PublicTranscript,
      transitionFunction: TransitionFunction,
      circuitValues: CircuitValues,
  )

  final case class DeployContractInput(
      contractSource: ContractSource,
      publicState: PublicState,
  )

  sealed trait Error extends Exception
  final case class TransactionRejected(reason: String) extends Error // FIXME not an exception
}
