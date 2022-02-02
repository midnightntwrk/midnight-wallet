package io.iohk.midnight.wallet.api

import cats.MonadThrow
import cats.effect.Clock
import cats.effect.std.Random
import cats.syntax.flatMap.*
import cats.syntax.functor.*
import io.iohk.midnight.wallet.api.WalletAPI.*
import io.iohk.midnight.wallet.domain.*
import io.iohk.midnight.wallet.domain.Hashing.*
import io.iohk.midnight.wallet.services.{ProverService, SyncService}
import io.iohk.midnight.wallet.util.ClockOps.*
import io.iohk.midnight.wallet.util.HashOps.*
import java.time.Instant

trait WalletAPI[F[_]] {
  def callContract(contractInput: CallContractInput): F[Hash[CallTransaction]]

  def deployContract(contractInput: DeployContractInput): F[Hash[DeployTransaction]]
}

object WalletAPI {
  class Live[F[_]: MonadThrow: Clock: Random](
      proverService: ProverService[F],
      syncService: SyncService[F],
  ) extends WalletAPI[F] {
    override def callContract(input: CallContractInput): F[Hash[CallTransaction]] =
      for {
        proof <- proverService.prove(input.circuitValues)
        timestamp <- Clock[F].realTimeInstant
        transaction = buildCallTransaction(timestamp, input, proof)
        hash <- transaction.calculateHash
        _ <- syncService.submitTransaction(transaction.copy(hash = Some(hash)))
      } yield hash

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
        _ <- syncService.submitTransaction(transaction.copy(hash = Some(hash)))
      } yield hash

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
}
