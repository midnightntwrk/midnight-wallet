package io.iohk.midnight.wallet.blockchain.data

import cats.Functor
import cats.effect.std.Random
import cats.syntax.functor.*

import java.time.Instant

sealed trait Transaction {
  type TxType <: Transaction
  def hash: Hash[TxType]
  def timestamp: Instant
}

final case class CallTransaction(
    override val hash: Hash[CallTransaction],
    override val timestamp: Instant,
    address: Address,
    functionName: FunctionName,
    proof: Proof,
    nonce: Nonce,
    publicTranscript: Transcript,
) extends Transaction {
  override type TxType = CallTransaction
}

final case class DeployTransaction(
    override val hash: Hash[DeployTransaction],
    override val timestamp: Instant,
    contract: Contract,
    transitionFunctionCircuits: TransitionFunctionCircuits,
) extends Transaction {
  override type TxType = DeployTransaction
}

object Transaction {
  def calculateHash[F[_]: Functor: Random, TxType <: Transaction]: F[Hash[TxType]] =
    Random[F]
      .nextBytes(32)
      .map(new java.math.BigInteger(_))
      .map(_.abs())
      .map(String.format("%064x", _))
      .map(Hash[TxType])
}
