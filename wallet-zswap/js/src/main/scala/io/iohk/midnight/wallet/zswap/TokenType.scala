package io.iohk.midnight.wallet.zswap

import cats.{Eq, Show}
import io.iohk.midnight.js.interop.util.BigIntOps.*
import io.iohk.midnight.midnightNtwrkZswap.mod

type TokenType = mod.TokenType

object TokenType {
  private val DummyCostModel = mod.TransactionCostModel.dummyTransactionCostModel()

  lazy val Native: TokenType = mod.nativeToken()
  lazy val InputFeeOverhead: BigInt = DummyCostModel.inputFeeOverhead.toScalaBigInt
  lazy val OutputFeeOverhead: BigInt = DummyCostModel.outputFeeOverhead.toScalaBigInt

  def apply(name: String): TokenType = name

  given Eq[TokenType] = Eq.instance(_.contentEquals(_))
  given Show[TokenType] = Show.catsShowForString
}
