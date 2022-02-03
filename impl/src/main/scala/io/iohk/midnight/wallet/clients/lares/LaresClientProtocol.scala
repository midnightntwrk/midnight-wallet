package io.iohk.midnight.wallet.clients.lares

import io.circe.generic.extras.Configuration
import io.circe.generic.extras.semiauto.deriveConfiguredEncoder
import io.circe.generic.semiauto.{deriveDecoder, deriveEncoder}
import io.circe.{Decoder, Encoder, Json}
import io.iohk.midnight.wallet.clients.JsonRpcClient.JsonRpcEncodableAsMethod
import io.iohk.midnight.wallet.domain.*
import io.iohk.midnight.wallet.domain.AppliedBlock.{ResultMetadata, TransactionResult}

object LaresClientProtocol {

  case class ApplyBlockLocallyRequest(from: UserId, block: AppliedBlock)
  case class ApplyBlockLocallyResponse(events: List[SemanticEvent])

  object Serialization {

    // common
    implicit def hashEncoder[T]: Encoder[Hash[T]] = Encoder[String].contramap(_.toHexString)
    implicit val proofEncoder: Encoder[Proof] = Encoder[String].contramap(_.value)
    implicit val transitionFunctionCircuitsEncoder: Encoder[TransitionFunctionCircuits] =
      Encoder[Map[String, String]].contramap(_.values)
    implicit val transitionFunctionEncoder: Encoder[TransitionFunction] =
      Encoder[String].contramap(_.value)

    implicit val customConfig: Configuration =
      Configuration.default
        .copy(
          transformMemberNames = {
            case "contractHash" => "deployTransactionHash"
            case other          => other
          },
          transformConstructorNames = {
            case "CallTransaction"   => "call"
            case "DeployTransaction" => "deploy"
          },
          discriminator = Some("type"),
        )

    implicit val callTxEncoder: Encoder[CallTransaction] =
      deriveConfiguredEncoder[CallTransaction].mapJsonObject(
        _.+:("nonce" -> Json.fromString("nonce")),
      )
    implicit val deployTxEncoder: Encoder[DeployTransaction] = deriveEncoder
    implicit val txEncoder: Encoder[Transaction] = deriveConfiguredEncoder

    implicit val txResultMetadataEncoder: Encoder[ResultMetadata] = deriveEncoder
    implicit val txResultEncoder: Encoder[TransactionResult] = deriveEncoder
    implicit val blockHeightEncoder: Encoder[Block.Height] = Encoder[BigInt].contramap(_.value)
    implicit val blockHeaderEncoder: Encoder[AppliedBlock.Header] = deriveEncoder
    implicit val appliedBlockBodyEncoder: Encoder[AppliedBlock.Body] = deriveEncoder
    implicit val appliedBlockEncoder: Encoder[AppliedBlock] = deriveEncoder
    implicit val contactSourceEncoder: Encoder[ContractSource] = Encoder[String].contramap(_.value)
    implicit val publicStateEncoder: Encoder[PublicState] = Encoder[String].contramap(_.value)
    implicit val publicTranscriptEncoder: Encoder[PublicTranscript] =
      Encoder[String].contramap(_.value)
    implicit val userIdEncoder: Encoder[UserId] = Encoder[String].contramap(_.value)

    implicit val eventDecoder: Decoder[SemanticEvent] = Decoder[String].map(SemanticEvent.apply)
    implicit val publicStateDecoder: Decoder[PublicState] = Decoder[String].map(PublicState.apply)
    implicit val publicTranscriptDecoder: Decoder[PublicTranscript] =
      Decoder[String].map(PublicTranscript.apply)
    implicit val transactionRequestDecoder: Decoder[TransactionRequest] = deriveDecoder

    implicit val applyBlockLocallyRequestJsonEncodableAsInstanceInstance
        : JsonRpcEncodableAsMethod[ApplyBlockLocallyRequest] = () => "applyBlockLocally"
    implicit val applyBlockLocallyRequestEncoder: Encoder[ApplyBlockLocallyRequest] = deriveEncoder
    implicit val applyBlockLocallyResponseDecoder: Decoder[ApplyBlockLocallyResponse] =
      deriveDecoder

  }

}
