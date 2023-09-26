package io.iohk.midnight.wallet.zswap

import cats.{Eq, Show}

opaque type TokenType = Nothing

@SuppressWarnings(Array("org.wartremover.warts.TripleQuestionMark"))
object TokenType {
  lazy val Native: TokenType = ???
  lazy val InputFeeOverhead: BigInt = ???
  lazy val OutputFeeOverhead: BigInt = ???

  def apply(name: String): TokenType = ???

  given Eq[TokenType] = Eq.fromUniversalEquals
  given Show[TokenType] = Show.show(_ => ???)
}
