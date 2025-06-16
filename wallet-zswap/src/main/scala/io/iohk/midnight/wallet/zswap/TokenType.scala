package io.iohk.midnight.wallet.zswap

import cats.{Eq, Show}
import io.iohk.midnight.js.interop.util.BigIntOps.*
import io.iohk.midnight.midnightNtwrkZswap.mod as v1
import io.iohk.midnight.midnightNtwrkZswap.mod.TransactionCostModel

trait TokenType[T, CostModel] {
  def create(name: String): T

  def dummyCostModel: CostModel
  def native: T
  def inputFeeOverhead: BigInt
  def outputFeeOverhead: BigInt
  def fromJS(input: String): T
}

given TokenType[v1.TokenType, v1.TransactionCostModel] with {
  override def create(name: v1.CoinPublicKey): v1.TokenType = name
  override def fromJS(input: String): v1.TokenType = input
  override lazy val dummyCostModel: TransactionCostModel =
    v1.TransactionCostModel.dummyTransactionCostModel()
  override lazy val native: v1.TokenType =
    v1.nativeToken()
  override lazy val inputFeeOverhead: BigInt =
    dummyCostModel.inputFeeOverhead.toScalaBigInt
  override lazy val outputFeeOverhead: BigInt =
    dummyCostModel.outputFeeOverhead.toScalaBigInt
}

object TokenType {
  given Eq[v1.TokenType] = Eq.instance(_.contentEquals(_))
  given Show[v1.TokenType] = Show.catsShowForString
}
