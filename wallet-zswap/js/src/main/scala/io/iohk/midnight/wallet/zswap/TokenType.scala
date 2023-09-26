package io.iohk.midnight.wallet.zswap

import cats.{Eq, Show}
import io.iohk.midnight.js.interop.util.BigIntOps.*
import io.iohk.midnight.midnightZswap.mod

type TokenType = mod.TokenType

object TokenType {
  lazy val Native: TokenType = mod.nativeToken()
  lazy val InputFeeOverhead: BigInt = mod.inputFeeOverhead().toScalaBigInt
  lazy val OutputFeeOverhead: BigInt = mod.outputFeeOverhead().toScalaBigInt

  def apply(name: String): TokenType = name

  given Eq[TokenType] = Eq.instance(_.contentEquals(_))
  given Show[TokenType] = Show.catsShowForString
}
