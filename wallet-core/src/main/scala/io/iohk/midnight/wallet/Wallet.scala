package io.iohk.midnight.wallet

import cats.MonadThrow
import cats.effect.Clock
import cats.effect.std.Random
import cats.syntax.all.*
import fs2.Stream
import io.iohk.midnight.wallet.Wallet.*
import io.iohk.midnight.wallet.domain.*
import io.iohk.midnight.wallet.domain.Hashing.*
import io.iohk.midnight.wallet.domain.services.SyncService
import io.iohk.midnight.wallet.services.SubmitTxService.SubmissionResponse
import io.iohk.midnight.wallet.services.{LaresService, ProverService, SubmitTxService}
import io.iohk.midnight.wallet.util.ClockOps.*
import io.iohk.midnight.wallet.util.HashOps.*

import java.time.Instant

trait Wallet[F[_]] {
  def callContract(contractInput: CallContractInput): F[Hash[CallTransaction]]

  def deployContract(contractInput: DeployContractInput): F[Hash[DeployTransaction]]

  def sync(): Stream[F, Seq[SemanticEvent]]

  def getUserId(): F[UserId]
}

object Wallet {
  class Live[F[_]: MonadThrow: Clock: Random](
      proverService: ProverService[F],
      submitTxService: SubmitTxService[F],
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
        response <- submitTxService.submitTransaction(transaction.copy(hash = Some(hash)))
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

    override def sync(): Stream[F, Seq[SemanticEvent]] =
      syncService
        .sync()
        .evalMap(laresService.applyBlock)
        .evalTap { case (_, txRequests) => submitTxRequests(txRequests) }
        .map(_._1)

    private def submitTxRequests(txRequests: Seq[TransactionRequest]): F[Unit] =
      txRequests
        .map(CallContractInput.fromTxRequest)
        .traverse(callContract)
        .void

    override def getUserId(): F[UserId] = userId.pure
  }

  final case class CallContractInput(
      contractHash: Hash[DeployTransaction],
      nonce: Nonce,
      publicTranscript: PublicTranscript,
      transitionFunction: TransitionFunction,
      circuitValues: CircuitValues,
  )
  object CallContractInput {
    def fromTxRequest(txRequest: TransactionRequest): CallContractInput =
      CallContractInput(
        txRequest.contractId,
        txRequest.nonce,
        txRequest.publicTranscript,
        txRequest.function,
        CircuitValues.hardcoded,
      )
  }

  final case class DeployContractInput(
      contractSource: ContractSource,
      publicState: PublicState,
  )

  sealed trait Error extends Exception
  final case class TransactionRejected(reason: String) extends Error
}
