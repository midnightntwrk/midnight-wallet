package io.iohk.midnight.wallet.ouroboros.sync

import cats.syntax.all.*
import io.iohk.midnight.wallet.ouroboros.sync.TestDomain.{Block, Transaction}
import io.iohk.midnight.wallet.ouroboros.sync.protocol.LocalBlockSync.Hash
import org.scalacheck.Gen
import org.scalacheck.cats.implicits.*

object Generators {
  private val hexStringGen: Gen[String] =
    Gen
      .chooseNum(1, 200) // Reasonable size
      .map(_ * 2) // Has to be an even number
      .flatMap(Gen.buildableOfN[String, Char](_, Gen.hexChar))

  private def hashGen[T]: Gen[Hash] =
    hexStringGen.map(Hash(_))

  private val heightGen: Gen[Int] =
    Gen.posNum[Int]

  private val transactionGen: Gen[Transaction] =
    hashGen[Transaction].map(Transaction.apply)

  val blockGen: Gen[Block] =
    (heightGen, hashGen[Block], transactionGen).mapN { case (height, hash, txs) =>
      Block(height, hash, Seq(txs))
    }
}
