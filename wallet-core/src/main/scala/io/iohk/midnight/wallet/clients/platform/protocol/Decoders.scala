package io.iohk.midnight.wallet.clients.platform.protocol

import cats.syntax.all.*
import io.circe.Decoder
import io.circe.generic.semiauto.*
import io.iohk.midnight.wallet.clients.platform.protocol.ReceiveMessage.LocalTxSubmission
import io.iohk.midnight.wallet.clients.platform.protocol.ReceiveMessage.LocalTxSubmission.RejectTxDetails

import scala.util.Try

object Decoders {
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
      case ReceiveMessage.Type.LocalTxSubmission => Decoder[LocalTxSubmission].widen
    }
}
