package io.iohk.midnight.wallet.clients.platform.protocol

import cats.syntax.all.*
import io.circe.generic.semiauto.*
import io.circe.{Decoder, parser}
import io.iohk.midnight.wallet.clients.platform.protocol.ReceiveMessage.LocalTxSubmission.RejectTxDetails
import io.iohk.midnight.wallet.clients.platform.protocol.ReceiveMessage.{
  LocalBlockSync,
  LocalTxSubmission,
}
import io.iohk.midnight.wallet.domain.*
import java.time.Instant
import scala.util.Try

object Decoders {
  implicit lazy val transactionTypeDecoder: Decoder[TransactionType] =
    Decoder[String].emapTry(s => Try(TransactionType.withName(s)))

  implicit def hashDecoder[T]: Decoder[Hash[T]] =
    Decoder[String].map(Hash[T])

  implicit lazy val contractSourceDecoder: Decoder[ContractSource] =
    Decoder[String].map(ContractSource.apply)

  implicit lazy val transitionFunctionDecoder: Decoder[TransitionFunction] =
    Decoder[String].map(TransitionFunction.apply)

  implicit lazy val transitionFunctionCircuitsDecoder: Decoder[TransitionFunctionCircuits] =
    Decoder[Map[String, String]].map(TransitionFunctionCircuits.apply)

  implicit lazy val proofDecoder: Decoder[Proof] =
    Decoder[String].map(Proof.apply)

  implicit lazy val nonceDecoder: Decoder[Nonce] =
    Decoder[String].map(Nonce.apply)

  implicit lazy val callTransactionDecoder: Decoder[CallTransaction] =
    deriveDecoder

  implicit lazy val deployTransactionDecoder: Decoder[DeployTransaction] =
    deriveDecoder

  implicit lazy val publicStateDecoder: Decoder[PublicState] =
    Decoder[String].emapTry(parser.parse(_).toTry).map(PublicState.apply)

  implicit lazy val publicTranscriptDecoder: Decoder[PublicTranscript] =
    Decoder[String].emapTry(parser.parse(_).toTry).map(PublicTranscript.apply)

  implicit lazy val transactionDecoder: Decoder[Transaction] =
    Decoder.instance(_.get[TransactionType](TransactionType.Discriminator)).flatMap {
      case TransactionType.Call   => Decoder[CallTransaction].widen
      case TransactionType.Deploy => Decoder[DeployTransaction].widen
    }

  implicit lazy val successDecoder: Decoder[Receipt.Success.type] =
    Decoder.const(Receipt.Success)

  implicit lazy val receiptContractFailureDecoder: Decoder[Receipt.ContractFailure] =
    deriveDecoder

  implicit lazy val receiptZKFailureDecoder: Decoder[Receipt.ZKFailure] =
    deriveDecoder

  implicit lazy val ledgerFailureDecoder: Decoder[Receipt.LedgerFailure] =
    deriveDecoder

  implicit lazy val receiptTypeDecoder: Decoder[ReceiptType] =
    Decoder[String].emapTry(s => Try(ReceiptType.withName(s)))

  implicit lazy val receiptDecoder: Decoder[Receipt] =
    Decoder.instance(_.get[ReceiptType](ReceiptType.Discriminator)).flatMap {
      case ReceiptType.Success         => Decoder[Receipt.Success.type].widen
      case ReceiptType.ContractFailure => Decoder[Receipt.ContractFailure].widen
      case ReceiptType.ZKFailure       => Decoder[Receipt.ZKFailure].widen
      case ReceiptType.LedgerFailure   => Decoder[Receipt.LedgerFailure].widen
    }

  implicit lazy val blockHeightDecoder: Decoder[Block.Height] =
    Decoder[BigInt].emap(Block.Height.apply)

  implicit lazy val blockHeaderDecoder: Decoder[Block.Header] =
    Decoder.instance { c =>
      (
        c.get[Option[Hash[Block]]]("blockHash"),
        c.get[Hash[Block]]("parentBlockHash"),
        c.get[Block.Height]("height"),
        c.get[Instant]("timestamp"),
      ).mapN(Block.Header.apply)
    }

  implicit lazy val transactionWithReceiptDecoder: Decoder[TransactionWithReceipt] =
    Decoder.instance { c =>
      (
        c.get[Transaction]("transaction"),
        c.get[Receipt]("result"),
      ).mapN(TransactionWithReceipt.apply)
    }

  implicit lazy val blockDecoder: Decoder[Block] =
    Decoder.instance { c =>
      (
        c.get[Block.Header]("header"),
        c.downField("body").get[Seq[TransactionWithReceipt]]("transactionResults"),
      ).mapN(Block.apply)
    }

  implicit lazy val localBlockSyncTypeDecoder: Decoder[LocalBlockSync.Type] =
    Decoder[String].emapTry(s => Try(LocalBlockSync.Type.withName(s)))

  implicit lazy val awaitReplyDecoder: Decoder[LocalBlockSync.AwaitReply.type] =
    Decoder.const(LocalBlockSync.AwaitReply)

  implicit lazy val rollForwardDecoder: Decoder[LocalBlockSync.RollForward] =
    deriveDecoder

  implicit lazy val rollBackwardDecoder: Decoder[LocalBlockSync.RollBackward] =
    deriveDecoder

  implicit lazy val intersectFoundDecoder: Decoder[LocalBlockSync.IntersectFound] =
    deriveDecoder

  implicit lazy val intersectNotFoundDecoder: Decoder[LocalBlockSync.IntersectNotFound.type] =
    Decoder.const(LocalBlockSync.IntersectNotFound)

  implicit lazy val localBlockSyncDecoder: Decoder[LocalBlockSync] =
    Decoder
      .instance(_.get[LocalBlockSync.Type](LocalBlockSync.Type.Discriminator))
      .flatMap {
        case LocalBlockSync.Type.AwaitReply     => Decoder[LocalBlockSync.AwaitReply.type].widen
        case LocalBlockSync.Type.RollForward    => Decoder[LocalBlockSync.RollForward].widen
        case LocalBlockSync.Type.RollBackward   => Decoder[LocalBlockSync.RollBackward].widen
        case LocalBlockSync.Type.IntersectFound => Decoder[LocalBlockSync.IntersectFound].widen
        case LocalBlockSync.Type.IntersectNotFound =>
          Decoder[LocalBlockSync.IntersectNotFound.type].widen
      }

  implicit lazy val acceptTxDecoder: Decoder[LocalTxSubmission.AcceptTx.type] =
    Decoder.const(LocalTxSubmission.AcceptTx)

  implicit lazy val rejectTxDuplicateDecoder: Decoder[RejectTxDetails.Duplicate.type] =
    Decoder.const(RejectTxDetails.Duplicate)

  implicit lazy val rejectTxOtherDecoder: Decoder[RejectTxDetails.Other] =
    deriveDecoder

  implicit lazy val rejectTxDetailsTypeDecoder: Decoder[RejectTxDetails.Type] =
    Decoder[String].emapTry(s => Try(RejectTxDetails.Type.withName(s)))

  implicit lazy val rejectTxDetailsDecoder: Decoder[LocalTxSubmission.RejectTxDetails] =
    Decoder
      .instance(_.get[RejectTxDetails.Type](RejectTxDetails.Type.Discriminator))
      .flatMap {
        case RejectTxDetails.Type.Duplicate =>
          Decoder[LocalTxSubmission.RejectTxDetails.Duplicate.type].widen
        case RejectTxDetails.Type.Other => Decoder[LocalTxSubmission.RejectTxDetails.Other].widen
      }

  implicit lazy val rejectTxDecoder: Decoder[LocalTxSubmission.RejectTx] =
    deriveDecoder

  implicit val localTxSubmissionTypeDecoder: Decoder[LocalTxSubmission.Type] =
    Decoder[String].emapTry(s => Try(LocalTxSubmission.Type.withName(s)))

  implicit lazy val localTxSubmissionDecoder: Decoder[LocalTxSubmission] =
    Decoder
      .instance(_.get[LocalTxSubmission.Type](LocalTxSubmission.Type.Discriminator))
      .flatMap {
        case LocalTxSubmission.Type.AcceptTx => Decoder[LocalTxSubmission.AcceptTx.type].widen
        case LocalTxSubmission.Type.RejectTx => Decoder[LocalTxSubmission.RejectTx].widen
      }

  implicit lazy val receiveMessageTypeDecoder: Decoder[ReceiveMessage.Type] =
    Decoder[String].emapTry(s => Try(ReceiveMessage.Type.withName(s)))

  lazy val receiveMessageDecoder: Decoder[ReceiveMessage] =
    Decoder.instance(_.get[ReceiveMessage.Type](ReceiveMessage.Type.Discriminator)).flatMap {
      case ReceiveMessage.Type.LocalBlockSync    => Decoder[LocalBlockSync].widen
      case ReceiveMessage.Type.LocalTxSubmission => Decoder[LocalTxSubmission].widen
    }
}
