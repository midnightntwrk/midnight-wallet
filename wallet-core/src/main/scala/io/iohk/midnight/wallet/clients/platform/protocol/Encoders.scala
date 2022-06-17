package io.iohk.midnight.wallet.clients.platform.protocol

import io.circe.generic.semiauto.deriveEncoder
import io.circe.syntax.*
import io.circe.{Encoder, Json}
import io.iohk.midnight.wallet.clients.platform.protocol.SendMessage.*
import io.iohk.midnight.wallet.domain.*
import io.iohk.midnight.wallet.domain.Proof

object Encoders {
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

  implicit val submitTxEncoder: Encoder[LocalTxSubmission.SubmitTx] =
    deriveEncoder[LocalTxSubmission.SubmitTx].mapJson(
      _.deepMerge(
        Json.obj(LocalTxSubmission.Type.Discriminator := LocalTxSubmission.Type.SubmitTx.entryName),
      ),
    )

  implicit val localTxSubmissionDoneEncoder: Encoder[LocalTxSubmission.Done.type] =
    Encoder.instance(_ =>
      Json.obj(LocalTxSubmission.Type.Discriminator := LocalTxSubmission.Type.Done.entryName),
    )

  implicit val findIntersectEncoder: Encoder[LocalBlockSync.FindIntersect] =
    deriveEncoder[LocalBlockSync.FindIntersect].mapJson(
      _.deepMerge(
        Json.obj(LocalBlockSync.Type.Discriminator := LocalBlockSync.Type.FindIntersect.entryName),
      ),
    )

  implicit val requestNextEncoder: Encoder[LocalBlockSync.RequestNext.type] =
    Encoder.instance(_ =>
      Json.obj(LocalBlockSync.Type.Discriminator := LocalBlockSync.Type.RequestNext.entryName),
    )

  implicit val localBlockSyncDoneEncoder: Encoder[LocalBlockSync.Done.type] =
    Encoder.instance(_ =>
      Json.obj(LocalBlockSync.Type.Discriminator := LocalBlockSync.Type.Done.entryName),
    )

  implicit val localTxSubmissionEncoder: Encoder[LocalTxSubmission] =
    Encoder
      .instance[LocalTxSubmission] {
        case submitTx: LocalTxSubmission.SubmitTx =>
          Encoder[LocalTxSubmission.SubmitTx].apply(submitTx)
        case LocalTxSubmission.Done =>
          Encoder[LocalTxSubmission.Done.type].apply(LocalTxSubmission.Done)
      }
      .mapJson(
        _.deepMerge(
          Json.obj(SendMessage.Type.Discriminator := SendMessage.Type.LocalTxSubmission.entryName),
        ),
      )

  implicit val localBlockSyncEncoder: Encoder[LocalBlockSync] =
    Encoder
      .instance[LocalBlockSync] {
        case findIntersect: LocalBlockSync.FindIntersect =>
          Encoder[LocalBlockSync.FindIntersect].apply(findIntersect)
        case LocalBlockSync.RequestNext =>
          Encoder[LocalBlockSync.RequestNext.type].apply(LocalBlockSync.RequestNext)
        case LocalBlockSync.Done =>
          Encoder[LocalBlockSync.Done.type].apply(LocalBlockSync.Done)
      }
      .mapJson(
        _.deepMerge(
          Json.obj(SendMessage.Type.Discriminator := SendMessage.Type.LocalBlockSync.entryName),
        ),
      )

  val sendMessageEncoder: Encoder[SendMessage] =
    Encoder.instance {
      case lbs: LocalBlockSync    => Encoder[LocalBlockSync].apply(lbs)
      case lts: LocalTxSubmission => Encoder[LocalTxSubmission].apply(lts)
    }
}
