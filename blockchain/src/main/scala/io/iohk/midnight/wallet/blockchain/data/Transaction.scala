package io.iohk.midnight.wallet.blockchain.data

import cats.Functor
import cats.effect.std.Random
import cats.syntax.functor.*

import java.time.Instant

sealed trait Transaction {
  type TxType <: Transaction
  def calculateHash[F[_]: Functor: Random]: F[Hash[TxType]] =
    Random[F]
      .nextBytes(32)
      .map(new java.math.BigInteger(_))
      .map(_.abs())
      .map(String.format("%064x", _))
      .map(Hash[TxType])
}

final case class CallTransaction(
    hash: Option[Hash[CallTransaction]],
    nonce: Nonce,
    timestamp: Instant,
    contractHash: Hash[DeployTransaction],
    transitionFunction: TransitionFunction,
    proof: Option[Proof],
    publicTranscript: PublicTranscript,
) extends Transaction {
  override type TxType = CallTransaction
}

final case class DeployTransaction(
    hash: Option[Hash[DeployTransaction]],
    timestamp: Instant,
    contractSource: ContractSource,
    publicState: PublicState,
    transitionFunctionCircuits: TransitionFunctionCircuits,
) extends Transaction {
  override type TxType = DeployTransaction
}
