package io.iohk.midnight.wallet.api

import cats.MonadThrow
import cats.effect.Clock
import cats.effect.std.Random
import cats.syntax.flatMap.*
import cats.syntax.functor.*
import io.iohk.midnight.wallet.api.WalletAPI.*
import io.iohk.midnight.wallet.domain.*
import io.iohk.midnight.wallet.domain.Proof
import io.iohk.midnight.wallet.services.{PlatformService, ProverService}
import java.time.Instant
import scala.concurrent.duration.FiniteDuration

trait WalletAPI[F[_]] {
  def callContract(contractInput: CallContractInput): F[Hash[CallTransaction]]

  def deployContract(contractInput: DeployContractInput): F[Hash[DeployTransaction]]
}

object WalletAPI {
  class Live[F[_]: MonadThrow: Clock: Random](
      proverService: ProverService[F],
      platformService: PlatformService[F],
  ) extends WalletAPI[F] {
    override def callContract(input: CallContractInput): F[Hash[CallTransaction]] =
      for {
        proof <- proverService.prove(input.circuitValues)
        timestamp <- Clock[F].realTime
        hash <- generateRandomHash[CallTransaction]
        transaction = buildCallTransaction(hash, timestamp, input, proof)
        _ <- platformService.submitTransaction(transaction)
      } yield transaction.hash

    private def buildCallTransaction(
        hash: Hash[CallTransaction],
        timestamp: FiniteDuration,
        input: CallContractInput,
        proof: Proof,
    ): CallTransaction =
      CallTransaction(
        hash,
        Instant.ofEpochMilli(timestamp.toMillis),
        input.contractHash,
        input.transitionFunction,
        Some(proof),
        input.publicTranscript,
      )

    override def deployContract(input: DeployContractInput): F[Hash[DeployTransaction]] =
      for {
        timestamp <- Clock[F].realTime
        hash <- generateRandomHash[DeployTransaction]
        transaction = buildDeployTransaction(hash, timestamp, input)
        _ <- platformService.submitTransaction(transaction)
      } yield transaction.hash

    private def buildDeployTransaction(
        hash: Hash[DeployTransaction],
        timestamp: FiniteDuration,
        input: DeployContractInput,
    ): DeployTransaction =
      DeployTransaction(
        hash,
        Instant.ofEpochMilli(timestamp.toMillis),
        input.contractSource,
        input.publicState,
        TransitionFunctionCircuits(Map.empty),
      )

    private def generateRandomHash[T]: F[Hash[T]] =
      Random[F]
        .nextBytes(32)
        .map(new java.math.BigInteger(_))
        .map(_.abs())
        .map(String.format("%064x", _))
        .map(Hash[T])
  }

  case class CallContractInput(
      contractHash: Hash[DeployTransaction],
      publicTranscript: PublicTranscript,
      transitionFunction: TransitionFunction,
      circuitValues: CircuitValues,
  )

  case class DeployContractInput(
      contractSource: ContractSource,
      publicState: PublicState,
  )
}
