package io.iohk.midnight.wallet.ogmios.sync.protocol

import cats.syntax.all.*
import io.circe.generic.semiauto.*
import io.circe.Decoder
import io.iohk.midnight.wallet.blockchain.data.{
  Block,
  CallTransaction,
  ContractSource,
  DeployTransaction,
  Hash,
  Nonce,
  Proof,
  PublicState,
  PublicTranscript,
  Receipt,
  Transaction,
  TransactionWithReceipt,
  TransitionFunction,
  TransitionFunctionCircuits,
}
import io.iohk.midnight.wallet.ogmios.sync.protocol.TransactionType

import java.time.Instant

private[sync] object Decoders {
  private object Internals {
    implicit def hashDecoder[T]: Decoder[Hash[T]] =
      Decoder[String].map(Hash[T])

    implicit val contractSourceDecoder: Decoder[ContractSource] =
      Decoder[String].map(ContractSource.apply)

    implicit val transitionFunctionDecoder: Decoder[TransitionFunction] =
      Decoder[String].map(TransitionFunction.apply)

    implicit val transitionFunctionCircuitsDecoder: Decoder[TransitionFunctionCircuits] =
      Decoder[Map[String, String]].map(TransitionFunctionCircuits.apply)

    implicit val proofDecoder: Decoder[Proof] =
      Decoder[String].map(Proof.apply)

    implicit val nonceDecoder: Decoder[Nonce] =
      Decoder[String].map(Nonce.apply)

    implicit val callTransactionDecoder: Decoder[CallTransaction] =
      deriveDecoder

    implicit val deployTransactionDecoder: Decoder[DeployTransaction] =
      deriveDecoder

    // should be parsed as a json in the future
    implicit val publicStateDecoder: Decoder[PublicState] =
      Decoder[String].map(PublicState.fromString)

    // should be parsed as a json in the future
    implicit val publicTranscriptDecoder: Decoder[PublicTranscript] =
      Decoder[String].map(PublicTranscript.fromString)

    implicit val transactionDecoder: Decoder[Transaction] =
      Decoder.instance(_.get[TransactionType](TransactionType.Discriminator)).flatMap {
        case TransactionType.Call   => Decoder[CallTransaction].widen
        case TransactionType.Deploy => Decoder[DeployTransaction].widen
      }

    implicit val successDecoder: Decoder[Receipt.Success.type] =
      Decoder.const(Receipt.Success)

    implicit val receiptContractFailureDecoder: Decoder[Receipt.ContractFailure] =
      deriveDecoder

    implicit val receiptZKFailureDecoder: Decoder[Receipt.ZKFailure] =
      deriveDecoder

    implicit val ledgerFailureDecoder: Decoder[Receipt.LedgerFailure] =
      deriveDecoder

    implicit val receiptDecoder: Decoder[Receipt] =
      Decoder.instance(_.get[ReceiptType](ReceiptType.Discriminator)).flatMap {
        case ReceiptType.Success         => Decoder[Receipt.Success.type].widen
        case ReceiptType.ContractFailure => Decoder[Receipt.ContractFailure].widen
        case ReceiptType.ZKFailure       => Decoder[Receipt.ZKFailure].widen
        case ReceiptType.LedgerFailure   => Decoder[Receipt.LedgerFailure].widen
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

    implicit val transactionWithReceiptDecoder: Decoder[TransactionWithReceipt] =
      Decoder.instance { c =>
        (
          c.get[Transaction]("transaction"),
          c.get[Receipt]("result"),
        ).mapN(TransactionWithReceipt.apply)
      }

    implicit val blockDecoder: Decoder[Block] =
      Decoder.instance { c =>
        (
          c.get[Block.Header]("header"),
          c.downField("body").get[Seq[TransactionWithReceipt]]("transactionResults"),
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
