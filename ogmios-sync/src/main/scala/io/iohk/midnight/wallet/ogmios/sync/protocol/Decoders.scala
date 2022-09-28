package io.iohk.midnight.wallet.ogmios.sync.protocol

import cats.syntax.all.*
import io.circe.Decoder
import io.circe.generic.semiauto.*
import io.iohk.midnight.wallet.blockchain.data.*
import io.iohk.midnight.wallet.ogmios.protocol.TransactionType

import java.time.Instant

private[sync] object Decoders {
  private object Internals {
    implicit def hashDecoder[T]: Decoder[Hash[T]] =
      Decoder[String].map(Hash[T])

    implicit val nonceDecoder: Decoder[Nonce] =
      Decoder[String].map(Nonce.apply)

    implicit val addressDecoder: Decoder[Address] =
      Decoder[String].map(Address.apply)

    implicit val functionNameDecoder: Decoder[FunctionName] =
      Decoder[String].map(FunctionName.apply)

    implicit val proofDecoder: Decoder[Proof] =
      Decoder[String].map(Proof.apply)

    implicit val transitionFunctionCircuitsDecoder: Decoder[TransitionFunctionCircuits] =
      Decoder[Seq[String]].map(TransitionFunctionCircuits.apply)

    implicit val arbitraryJsonDecoder: Decoder[ArbitraryJson] =
      json => Right(ArbitraryJson(json.value))

    implicit val queryDecoder: Decoder[Query] = deriveDecoder

    implicit val transcriptDecoder: Decoder[Transcript] =
      Decoder[Seq[Query]].map(Transcript.apply)

    implicit val privateOracleDecoder: Decoder[PrivateOracle] = deriveDecoder

    implicit val publicOracleDecoder: Decoder[PublicOracle] = deriveDecoder

    implicit val contractDecoder: Decoder[Contract] = deriveDecoder

    implicit val callTransactionDecoder: Decoder[CallTransaction] =
      deriveDecoder

    implicit val deployTransactionDecoder: Decoder[DeployTransaction] =
      deriveDecoder

    implicit val transactionDecoder: Decoder[Transaction] =
      Decoder.instance(_.get[TransactionType](TransactionType.Discriminator)).flatMap {
        case TransactionType.Call   => Decoder[CallTransaction].widen
        case TransactionType.Deploy => Decoder[DeployTransaction].widen
      }

    implicit val blockHeightDecoder: Decoder[Block.Height] =
      Decoder[BigInt].emap(Block.Height.apply)

    implicit val blockHeaderDecoder: Decoder[Block.Header] =
      Decoder.instance { c =>
        (
          c.get[Hash[Block]]("blockHash"),
          c.get[Hash[Block]]("parentBlockHash"),
          c.get[Block.Height]("height"),
          c.get[Instant]("timestamp"),
        ).mapN(Block.Header.apply)
      }

    implicit val transactionResultDecoder: Decoder[TransactionResult] =
      Decoder.instance { c =>
        (
          c.get[Transaction]("transaction"),
          c.get[TransactionResult.Result]("result"),
        ).mapN(TransactionResult.apply)
      }

    implicit val blockBodyDecoder: Decoder[Block.Body] =
      Decoder.instance {
        _.get[Seq[TransactionResult]]("transactionResults").map(Block.Body.apply)
      }

    implicit val blockDecoder: Decoder[Block] =
      Decoder.instance { c =>
        (
          c.get[Block.Header]("header"),
          c.get[Block.Body]("body"),
        ).mapN(Block.apply)
      }

    implicit val awaitReplyDecoder: Decoder[LocalBlockSync.Receive.AwaitReply.type] =
      Decoder.const(LocalBlockSync.Receive.AwaitReply)

    implicit val rollForwardDecoder: Decoder[LocalBlockSync.Receive.RollForward] =
      deriveDecoder

    implicit val rollBackwardDecoder: Decoder[LocalBlockSync.Receive.RollBackward] =
      deriveDecoder

    implicit val intersectFoundDecoder: Decoder[LocalBlockSync.Receive.IntersectFound] =
      deriveDecoder

    implicit val intersectNotFoundDecoder: Decoder[LocalBlockSync.Receive.IntersectNotFound.type] =
      Decoder.const(LocalBlockSync.Receive.IntersectNotFound)
  }

  import Internals.*
  implicit val localBlockSyncDecoder: Decoder[LocalBlockSync.Receive] =
    Decoder
      .instance(_.get[LocalBlockSync.Receive.Type](LocalBlockSync.Receive.Type.Discriminator))
      .flatMap {
        case LocalBlockSync.Receive.Type.AwaitReply =>
          Decoder[LocalBlockSync.Receive.AwaitReply.type].widen
        case LocalBlockSync.Receive.Type.RollForward =>
          Decoder[LocalBlockSync.Receive.RollForward].widen
        case LocalBlockSync.Receive.Type.RollBackward =>
          Decoder[LocalBlockSync.Receive.RollBackward].widen
        case LocalBlockSync.Receive.Type.IntersectFound =>
          Decoder[LocalBlockSync.Receive.IntersectFound].widen
        case LocalBlockSync.Receive.Type.IntersectNotFound =>
          Decoder[LocalBlockSync.Receive.IntersectNotFound.type].widen
      }
}
