package io.iohk.midnight.wallet.blockchain.data

import cats.ApplicativeThrow
import cats.syntax.applicative.*
import cats.syntax.applicativeError.*
import io.circe

final case class ArbitraryJson(value: circe.Json) extends AnyVal
object ArbitraryJson {
  def parse[F[_]: ApplicativeThrow](str: String): F[ArbitraryJson] =
    circe.parser
      .parse(str)
      .fold(_.raiseError, ArbitraryJson(_).pure)
}
