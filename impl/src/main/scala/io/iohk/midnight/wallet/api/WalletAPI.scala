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
import io.iohk.midnight.wallet.store.PrivateStateStore
import scala.scalajs.js.annotation.JSExport

trait WalletAPI[F[_]]:
  def getPrivateState(contractId: ContractId): F[Option[ContractPrivateState]]

  def callContract(contractInput: ContractInput): F[Hash]

object WalletAPI:
  class Live[F[_]: MonadThrow: Clock](
      privateStateStore: PrivateStateStore[F],
      circuitValuesExtractor: CircuitValuesExtractor,
      proverService: ProverService[F],
      platformClient: PlatformClient[F],
  ) extends WalletAPI[F]:
    @JSExport
    override def getPrivateState(contractId: ContractId): F[Option[ContractPrivateState]] =
      privateStateStore.getState(contractId)

    @JSExport
    override def callContract(input: ContractInput): F[Hash] =
      for
        proof <- proverService.prove(circuitValuesExtractor.extractValues(input))
        transaction <- Clock[F].realTimeDate.map(Transaction(input, proof, _))
        _ <- platformClient.submitTransaction(transaction)
        _ <- privateStateStore.setState(input.contractId, input.contractState.privateState)
      yield transaction.hash
