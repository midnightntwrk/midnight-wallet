package io.iohk.midnight.wallet.api

import cats.Monad
import cats.syntax.applicative.*
import cats.syntax.flatMap.*
import cats.syntax.functor.*
import io.iohk.midnight.wallet.circuit.CircuitValuesExtractor
import io.iohk.midnight.wallet.clients.{PlatformClient, ProverClient}
import io.iohk.midnight.wallet.domain.*
import io.iohk.midnight.wallet.store.PrivateStateStore
import io.iohk.midnight.wallet.transaction.TransactionBuilder
import scala.scalajs.js.annotation.{JSExport, JSExportTopLevel}

trait WalletAPI[F[_]]:
  def getPrivateState(contract: Contract): F[Option[ContractPrivateState]]

  def callContract(contractInput: ContractInput): F[Hash]

object WalletAPI:
  @JSExportTopLevel("WalletAPI")
  class Live[F[_]: Monad](
      privateStateStore: PrivateStateStore[F],
      transactionBuilder: TransactionBuilder[F],
      circuitValuesExtractor: CircuitValuesExtractor,
      prover: ProverClient[F],
      node: PlatformClient[F]
  ) extends WalletAPI[F]:
    @JSExport
    override def getPrivateState(contract: Contract): F[Option[ContractPrivateState]] =
      privateStateStore.getState(contract)

    @JSExport
    override def callContract(input: ContractInput): F[Hash] =
      for
        proofId <- prover.prove(circuitValuesExtractor.extractValues(input))
        proof <- pollForProof(proofId)
        transaction <- transactionBuilder.buildTransaction(input, proof)
        _ <- node.submitTransaction(transaction)
        _ <- privateStateStore.setState(input.contract, input.contractState.privateState)
      yield transaction.hash

    private def pollForProof(proofId: ProofId): F[Proof] =
      proofId.tailRecM(prover.proofStatus(_).map {
        case ProofStatus.Done(proof) => Right(proof)
        case ProofStatus.InProgress  => Left(proofId)
      })
