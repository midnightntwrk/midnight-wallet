package io.iohk.midnight.wallet.blockchain.data

import java.time.Instant
import org.scalacheck.Gen

object Generators {
  private val hexStringGen: Gen[String] =
    Gen
      .chooseNum(1, 200) // Reasonable size
      .map(_ * 2) // Has to be an even number
      .flatMap(Gen.buildableOfN[String, Char](_, Gen.hexChar))

  def hashGen[T]: Gen[Hash[T]] =
    hexStringGen.map(Hash.apply[T])

  val heightGen: Gen[Transaction.Offset] =
    Gen.posNum[BigInt].map(Transaction.Offset.apply)

  val instantGen: Gen[Instant] =
    Gen.long.map(Instant.ofEpochMilli)
}
