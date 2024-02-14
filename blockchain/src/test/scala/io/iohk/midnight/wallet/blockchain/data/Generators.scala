package io.iohk.midnight.wallet.blockchain.data

import cats.syntax.all.*
import java.time.Instant
import org.scalacheck.Gen
import org.scalacheck.cats.implicits.*

object Generators {
  private val hexStringGen: Gen[String] =
    Gen
      .chooseNum(1, 200) // Reasonable size
      .map(_ * 2) // Has to be an even number
      .flatMap(Gen.buildableOfN[String, Char](_, Gen.hexChar))

  def hashGen[T]: Gen[Hash[T]] =
    hexStringGen.map(Hash.apply[T])

  val heightGen: Gen[Transaction.Offset] =
    Gen.posNum[BigInt].map(Transaction.Offset.apply).collect { case Right(n) => n }

  val instantGen: Gen[Instant] =
    Gen.long.map(Instant.ofEpochMilli)
}
