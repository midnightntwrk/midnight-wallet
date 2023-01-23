package io.iohk.midnight.wallet.core

import cats.Show
import cats.syntax.all.*
import io.circe.generic.semiauto.{deriveDecoder, deriveEncoder}
import io.circe.{Decoder, Encoder}
import io.iohk.midnight.wallet.blockchain.data.{Block, Hash, Transaction}

import java.time.Instant

object Instances {

  implicit val instantShow: Show[Instant] = cats.Show.fromToString

  implicit val blockShow: Show[Block] =
    Show.show(_.header.hash.toHexString)

  implicit def hashEncoder[T]: Encoder[Hash[T]] =
    Encoder[String].contramap(_.toHexString)

  implicit def hashDecoder[T]: Decoder[Hash[T]] =
    Decoder[String].map(Hash[T])

  implicit val transactionHeaderDecoder: Decoder[Transaction.Header] =
    deriveDecoder[Transaction.Header]

  implicit val transactionDecoder: Decoder[Transaction] =
    deriveDecoder[Transaction]

  implicit val transactionHeaderEncoder: Encoder[Transaction.Header] =
    deriveEncoder[Transaction.Header]

  implicit val transactionEncoder: Encoder[Transaction] =
    deriveEncoder[Transaction]

  implicit val transactionShow: Show[Transaction] =
    Show.show(_.header.hash.toHexString)

  implicit val blockHeightDecoder: Decoder[Block.Height] =
    Decoder[BigInt].emap(Block.Height.apply)

  implicit val blockHeaderDecoder: Decoder[Block.Header] =
    Decoder.instance { c =>
      (
        c.get[Hash[Block]]("hash"),
        c.get[Hash[Block]]("parentHash"),
        c.get[Block.Height]("height"),
        c.get[Instant]("timestamp"),
      ).mapN(Block.Header.apply)
    }

  implicit val blockBodyDecoder: Decoder[Block.Body] =
    Decoder.instance {
      _.get[Seq[Transaction]]("transactionResults")
        .map(Block.Body.apply)
    }

  implicit val blockDecoder: Decoder[Block] =
    Decoder.instance { c =>
      (
        c.get[Block.Header]("header"),
        c.get[Block.Body]("body"),
      ).mapN(Block.apply)
    }
}
