package io.iohk.midnight.wallet.ouroboros.tx_submission.protocol

import io.circe.generic.semiauto.deriveEncoder
import io.circe.syntax.*
import io.circe.{Encoder, Json}
import io.iohk.midnight.wallet.ouroboros.tx_submission.protocol.LocalTxSubmission.Send.SubmitTx

import scala.annotation.unused

private[tx_submission] object Encoders {
  private object Internals {
    implicit def submitTxEncoder[Transaction](implicit
        @unused e: Encoder[Transaction],
    ): Encoder[SubmitTx[Transaction]] =
      deriveEncoder[LocalTxSubmission.Send.SubmitTx[Transaction]].mapJson(
        _.deepMerge(
          Json.obj(
            LocalTxSubmission.Send.Type.Discriminator := LocalTxSubmission.Send.Type.SubmitTx.entryName,
          ),
        ),
      )

    implicit val localTxSubmissionDoneEncoder: Encoder[LocalTxSubmission.Send.Done.type] =
      Encoder.instance(_ =>
        Json.obj(
          LocalTxSubmission.Send.Type.Discriminator := LocalTxSubmission.Send.Type.Done.entryName,
        ),
      )
  }

  implicit def localTxSubmissionEncoder[Transaction: Encoder]
      : Encoder[LocalTxSubmission.Send[Transaction]] = {
    import Internals.*

    Encoder
      .instance[LocalTxSubmission.Send[Transaction]] {
        case LocalTxSubmission.Send.SubmitTx(transaction) =>
          Encoder[LocalTxSubmission.Send.SubmitTx[Transaction]].apply(SubmitTx(transaction))
        case LocalTxSubmission.Send.Done =>
          Encoder[LocalTxSubmission.Send.Done.type].apply(LocalTxSubmission.Send.Done)
      }
      .mapJson(
        _.deepMerge(
          Json.obj(
            LocalTxSubmission.Protocol.Discriminator := LocalTxSubmission.Protocol.Name,
          ),
        ),
      )
  }
}
