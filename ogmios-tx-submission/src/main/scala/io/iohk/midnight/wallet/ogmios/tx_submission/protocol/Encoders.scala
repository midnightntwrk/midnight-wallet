package io.iohk.midnight.wallet.ogmios.tx_submission.protocol

import io.circe.generic.semiauto.deriveEncoder
import io.circe.syntax.*
import io.circe.{Encoder, Json}
import io.iohk.midnight.wallet.blockchain.data.{
  CallTransaction,
  ContractSource,
  DeployTransaction,
  Hash,
  Nonce,
  Proof,
  PublicState,
  PublicTranscript,
  Transaction,
  TransitionFunction,
  TransitionFunctionCircuits,
}
import io.iohk.midnight.wallet.ogmios.protocol.TransactionType
import io.iohk.midnight.wallet.ogmios.tx_submission.protocol.LocalTxSubmission.Send.SubmitTx

private[tx_submission] object Encoders {
  private object Internals {
    implicit def hashEncoder[T]: Encoder[Hash[T]] =
      Encoder[String].contramap(_.toHexString)

    implicit val contractSourceEncoder: Encoder[ContractSource] =
      Encoder[String].contramap(_.value)

    implicit val publicStateEncoder: Encoder[PublicState] =
      Encoder[String].contramap(_.value.noSpaces)

    implicit val transitionFunctionEncoder: Encoder[TransitionFunction] =
      Encoder[String].contramap(_.value)

    implicit val transitionFunctionCircuitsEncoder: Encoder[TransitionFunctionCircuits] =
      Encoder[Map[String, String]].contramap(_.values)

    implicit val proofEncoder: Encoder[Proof] =
      Encoder[String].contramap(_.value)

    implicit val publicTranscriptEncoder: Encoder[PublicTranscript] =
      Encoder[String].contramap(_.value.noSpaces)

    implicit val nonceEncoder: Encoder[Nonce] =
      Encoder[String].contramap(_.value)

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
        .mapJson(
          _.deepMerge(
            Json.obj(TransactionKind.Discriminator := TransactionKind.Lares.entryName),
          ),
        )

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
