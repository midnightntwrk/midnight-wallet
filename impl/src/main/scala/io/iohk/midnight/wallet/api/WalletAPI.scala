package io.iohk.midnight.wallet.api

import cats.MonadThrow
import cats.effect.Clock
import cats.syntax.applicative.*
import cats.syntax.applicativeError.*
import cats.syntax.flatMap.*
import cats.syntax.functor.*
import io.iohk.midnight.wallet.circuit.CircuitValuesExtractor
import io.iohk.midnight.wallet.clients.PlatformClient
import io.iohk.midnight.wallet.domain.*
import io.iohk.midnight.wallet.services.ProverService
import scala.scalajs.js.annotation.JSExport

trait WalletAPI[F[_]]:
  def callContract(contractInput: CallContractInput): F[Hash]

  def deployContract(contractInput: DeployContractInput): F[Hash]

object WalletAPI:
  class Live[F[_]: MonadThrow: Clock](
      circuitValuesExtractor: CircuitValuesExtractor,
      proverService: ProverService[F],
      platformClient: PlatformClient[F],
  ) extends WalletAPI[F]:
    @JSExport
    override def callContract(input: CallContractInput): F[Hash] =
      for
        proof <- proverService.prove(circuitValuesExtractor.extractValues(input))
        transaction <- Clock[F].realTimeDate.map(CallTransaction(input, proof, _))
        _ <- platformClient.submitTransaction(transaction)
      yield transaction.hash

    @JSExport
    override def deployContract(input: DeployContractInput): F[Hash] =
      for
        transaction <- Clock[F].realTimeDate.map(
          DeployTransaction(
            input,
            circuitValuesExtractor.extractTransitionFunctionCircuits(input),
            _,
          ),
        )
        _ <- platformClient.submitTransaction(transaction)
      yield transaction.hash
