package io.iohk.midnight.wallet.ogmios.tx_submission.protocol

import io.circe.generic.semiauto.deriveEncoder
import io.circe.syntax.*
import io.circe.{Encoder, Json}
import io.iohk.midnight.wallet.blockchain.data.*
import io.iohk.midnight.wallet.ogmios.tx_submission.protocol.LocalTxSubmission.Send.SubmitTx

private[tx_submission] object Encoders {
  private object Internals {
    implicit def hashEncoder[T]: Encoder[Hash[T]] =
      Encoder[String].contramap(_.toHexString)

    implicit val transactionHeaderEncoder: Encoder[Transaction.Header] =
      deriveEncoder[Transaction.Header]

    implicit val transactionEncoder: Encoder[Transaction] =
      deriveEncoder[Transaction]

    implicit val submitTxEncoder: Encoder[SubmitTx] =
      deriveEncoder[LocalTxSubmission.Send.SubmitTx].mapJson(
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

  import Internals.*
  implicit val localTxSubmissionEncoder: Encoder[LocalTxSubmission.Send] =
    Encoder
      .instance[LocalTxSubmission.Send] {
        case submitTx: LocalTxSubmission.Send.SubmitTx =>
          Encoder[LocalTxSubmission.Send.SubmitTx].apply(submitTx)
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
