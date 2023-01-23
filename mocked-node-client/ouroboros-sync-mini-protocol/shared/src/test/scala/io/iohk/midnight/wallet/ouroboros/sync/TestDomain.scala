package io.iohk.midnight.wallet.ouroboros.sync

import cats.Show
import cats.syntax.all.*
import io.circe.Decoder
import io.iohk.midnight.wallet.ouroboros.sync.protocol.LocalBlockSync.Hash

object TestDomain {
  final case class Block(height: Int, hash: Hash, transactions: Seq[Transaction])

  object Block {
    implicit val decoder: Decoder[Block] = Decoder.instance { c =>
      (
        c.get[Int]("height"),
        c.get[Hash]("hash"),
        c.get[Seq[Transaction]]("transactions"),
      ).mapN(Block.apply)
    }
    implicit val show: Show[Block] = Show.show(_.hash.value)
  }

  final case class Transaction(hash: Hash)

  object Transaction {
    implicit val decoder: Decoder[Transaction] = Decoder.instance { c =>
      c.get[Hash]("hash").map(Transaction(_))
    }
  }
}
