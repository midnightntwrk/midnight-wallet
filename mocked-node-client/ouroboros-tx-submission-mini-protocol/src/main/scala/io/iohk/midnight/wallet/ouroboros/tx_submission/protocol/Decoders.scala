package io.iohk.midnight.wallet.ouroboros.tx_submission.protocol

import cats.syntax.all.*
import io.circe.Decoder
import io.circe.generic.semiauto.*
import io.iohk.midnight.wallet.ouroboros.tx_submission.protocol.LocalTxSubmission.Receive.RejectTxDetails
import io.iohk.midnight.wallet.ouroboros.tx_submission.protocol.LocalTxSubmission.Receive.RejectTxDetails.Duplicate

private[tx_submission] object Decoders {
  private object Internals {
    implicit val acceptTxDecoder: Decoder[LocalTxSubmission.Receive.AcceptTx.type] =
      Decoder.const(LocalTxSubmission.Receive.AcceptTx)

    implicit val rejectTxDuplicateDecoder: Decoder[Duplicate.type] =
      Decoder.const(RejectTxDetails.Duplicate)

    implicit val rejectTxOtherDecoder: Decoder[RejectTxDetails.Other] =
      deriveDecoder

    implicit val rejectTxDetailsDecoder: Decoder[LocalTxSubmission.Receive.RejectTxDetails] =
      Decoder
        .instance(_.get[RejectTxDetails.Type](RejectTxDetails.Type.Discriminator))
        .flatMap {
          case RejectTxDetails.Type.Duplicate =>
            Decoder[LocalTxSubmission.Receive.RejectTxDetails.Duplicate.type].widen
          case RejectTxDetails.Type.Other =>
            Decoder[LocalTxSubmission.Receive.RejectTxDetails.Other].widen
        }

    implicit val rejectTxDecoder: Decoder[LocalTxSubmission.Receive.RejectTx] =
      deriveDecoder
  }

  import Internals.*
  implicit val localTxSubmissionDecoder: Decoder[LocalTxSubmission.Receive] =
    Decoder
      .instance(_.get[LocalTxSubmission.Receive.Type](LocalTxSubmission.Receive.Type.Discriminator))
      .flatMap {
        case LocalTxSubmission.Receive.Type.AcceptTx =>
          Decoder[LocalTxSubmission.Receive.AcceptTx.type].widen
        case LocalTxSubmission.Receive.Type.RejectTx =>
          Decoder[LocalTxSubmission.Receive.RejectTx].widen
      }
}
