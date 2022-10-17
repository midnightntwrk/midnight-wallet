package io.iohk.midnight.wallet.core

import cats.MonadThrow
import cats.effect.Clock
import cats.syntax.all.*
import fs2.Stream
import io.iohk.midnight.wallet.blockchain.data
import io.iohk.midnight.wallet.blockchain.data.*
import io.iohk.midnight.wallet.core.Wallet.{CallContractInput, DeployContractInput}
import io.iohk.midnight.wallet.core.services.TxSubmissionService.SubmissionResult
import io.iohk.midnight.wallet.core.services.{SyncService, TxSubmissionService}
import io.iohk.midnight.wallet.core.util.ClockOps.*

import java.time.Instant

trait Wallet[F[_]] {
  def callContract(contractInput: CallContractInput): F[Hash[CallTransaction]]

  def deployContract(contractInput: DeployContractInput): F[Hash[DeployTransaction]]

  def sync(): Stream[F, Block]
}

object Wallet {
  class Live[F[_]: MonadThrow: Clock](
      submitTxService: TxSubmissionService[F],
      syncService: SyncService[F],
  ) extends Wallet[F] {
    override def callContract(input: CallContractInput): F[Hash[CallTransaction]] =
      for {
        timestamp <- Clock[F].realTimeInstant
        transaction = buildCallTransaction(input.hash, timestamp, input, input.proof)
        response <- submitTxService.submitTransaction(transaction)
        result <- response match {
          case SubmissionResult.Accepted         => input.hash.pure
          case SubmissionResult.Rejected(reason) => TransactionRejected(reason).raiseError
        }
      } yield result

    private def buildCallTransaction(
        hash: Hash[data.CallTransaction],
        timestamp: Instant,
        input: CallContractInput,
        proof: Proof,
    ): CallTransaction =
      data.CallTransaction(
        hash,
        timestamp,
        input.address,
        input.func,
        proof,
        input.nonce,
        input.publicTranscript,
      )

    override def deployContract(input: DeployContractInput): F[Hash[DeployTransaction]] =
      for {
        timestamp <- Clock[F].realTimeInstant
        transaction = buildDeployTransaction(input.hash, timestamp, input)
        response <- submitTxService.submitTransaction(transaction)
        result <- response match {
          case SubmissionResult.Accepted => input.hash.pure
          case SubmissionResult.Rejected(reason) =>
            TransactionRejected(reason).raiseError
        }
      } yield result

    private def buildDeployTransaction(
        hash: Hash[data.DeployTransaction],
        timestamp: Instant,
        input: DeployContractInput,
    ): DeployTransaction =
      DeployTransaction(
        hash,
        timestamp,
        input.publicOracle,
        input.transitionFunctionCircuits,
      )

    override def sync(): Stream[F, Block] =
      syncService.sync()
  }

  final case class CallContractInput(
      hash: Hash[CallTransaction],
      address: Address,
      func: FunctionName,
      nonce: Nonce,
      proof: Proof,
      publicTranscript: Transcript,
  )

  final case class DeployContractInput(
      hash: Hash[DeployTransaction],
      publicOracle: PublicOracle,
      transitionFunctionCircuits: TransitionFunctionCircuits,
  )

  sealed trait Error extends Exception
  final case class TransactionRejected(reason: String) extends Error // FIXME not an exception
}
