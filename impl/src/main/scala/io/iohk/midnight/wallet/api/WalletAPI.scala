package io.iohk.midnight.wallet.api

import cats.MonadThrow
import cats.effect.Clock
import cats.syntax.applicative.*
import cats.syntax.applicativeError.*
import cats.syntax.flatMap.*
import cats.syntax.functor.*
import io.iohk.midnight.wallet.api.WalletAPI.*
import io.iohk.midnight.wallet.clients.PlatformClient
import io.iohk.midnight.wallet.domain.*
import io.iohk.midnight.wallet.services.ProverService
import scala.scalajs.js.annotation.JSExport
import scalajs.js

trait WalletAPI[F[_]]:
  def callContract(contractInput: CallContractInput): F[CallTransaction.Hash]

  def deployContract(contractInput: DeployContractInput): F[DeployTransaction.Hash]

object WalletAPI:
  class Live[F[_]: MonadThrow: Clock](
      proverService: ProverService[F],
      platformClient: PlatformClient[F],
  ) extends WalletAPI[F]:
    @JSExport
    override def callContract(input: CallContractInput): F[CallTransaction.Hash] =
      for
        proof <- proverService.prove(input.circuitValues)
        transaction <- Clock[F].realTimeDate.map(buildCallTransaction(_, input, proof))
        _ <- platformClient.submitTransaction(transaction)
      yield transaction.hash

    private def buildCallTransaction(timestamp: js.Date, input: CallContractInput, proof: Proof) =
      CallTransaction(
        CallTransaction.Hash(),
        timestamp,
        input.contractHash,
        input.transitionFunction,
        proof,
        input.publicTranscript,
      )

    @JSExport
    override def deployContract(input: DeployContractInput): F[DeployTransaction.Hash] =
      for
        transaction <- Clock[F].realTimeDate.map(buildDeployTransaction(_, input))
        _ <- platformClient.submitTransaction(transaction)
      yield transaction.hash

    private def buildDeployTransaction(timestamp: js.Date, input: DeployContractInput) =
      DeployTransaction(
        DeployTransaction.Hash(),
        timestamp,
        input.contractSource,
        TransitionFunctionCircuits(),
      )

  case class CallContractInput(
      contractHash: DeployTransaction.Hash,
      publicTranscript: PublicTranscript,
      transitionFunction: TransitionFunction,
      circuitValues: CircuitValues,
  )

  case class DeployContractInput(
      contractSource: ContractSource,
  )
