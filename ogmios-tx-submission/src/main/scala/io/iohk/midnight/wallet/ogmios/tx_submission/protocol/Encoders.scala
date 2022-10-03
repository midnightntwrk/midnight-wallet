package io.iohk.midnight.wallet.ogmios.tx_submission.protocol

import io.circe.generic.semiauto.deriveEncoder
import io.circe.syntax.*
import io.circe.{Encoder, Json}
import io.iohk.midnight.wallet.blockchain.data.*
import io.iohk.midnight.wallet.ogmios.protocol.TransactionType
import io.iohk.midnight.wallet.ogmios.tx_submission.protocol.LocalTxSubmission.Send.SubmitTx

private[tx_submission] object Encoders {
  private object Internals {
    implicit def hashEncoder[T]: Encoder[Hash[T]] =
      Encoder[String].contramap(_.toHexString)

    implicit val functionNameEncoder: Encoder[FunctionName] =
      Encoder[String].contramap(_.value)

    implicit val addressEncoder: Encoder[Address] =
      Encoder[String].contramap(_.value)

    implicit val nonceEncoder: Encoder[Nonce] =
      Encoder[String].contramap(_.value)

    implicit val proofEncoder: Encoder[Proof] =
      Encoder[String].contramap(_.value)

    implicit val transitionFunctionCircuitsEncoder: Encoder[TransitionFunctionCircuits] =
      Encoder[Seq[String]].contramap(_.value)

    implicit val arbitraryJsonEncoder: Encoder[ArbitraryJson] =
      _.value

    implicit val queryEncoder: Encoder[Query] = deriveEncoder[Query]

    implicit val transcriptEncoder: Encoder[Transcript] =
      Encoder[Seq[Query]].contramap(_.value)

    implicit val oracleEncoder: Encoder[Oracle] = deriveEncoder[Oracle]

    implicit val contractEncoder: Encoder[Contract] = deriveEncoder[Contract]

    implicit val callTransactionEncoder: Encoder[CallTransaction] =
      deriveEncoder[CallTransaction].mapJson(
        _.deepMerge(
          Json.obj(
            TransactionType.Discriminator := TransactionType.Call.entryName,
          ),
        ),
      )

    implicit val deployTransactionEncoder: Encoder[DeployTransaction] =
      deriveEncoder[DeployTransaction].mapJson(
        _.deepMerge(
          Json.obj(
            TransactionType.Discriminator := TransactionType.Deploy.entryName,
          ),
        ),
      )

    implicit val transactionEncoder: Encoder[Transaction] =
      Encoder
        .instance[Transaction] {
          case call: CallTransaction     => Encoder[CallTransaction].apply(call)
          case deploy: DeployTransaction => Encoder[DeployTransaction].apply(deploy)
        }

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
