package io.iohk.midnight.wallet.clients.lares

import io.circe.generic.extras.Configuration
import io.circe.generic.extras.semiauto.deriveConfiguredEncoder
import io.circe.generic.semiauto.{deriveDecoder, deriveEncoder}
import io.circe.syntax.EncoderOps
import io.circe.{Decoder, Encoder, Json, JsonObject}
import io.iohk.midnight.wallet.clients.JsonRpcClient.JsonRpcEncodableAsMethod
import io.iohk.midnight.wallet.domain.*

object LaresClientProtocol {

  case class ApplyBlockLocallyRequest(from: UserId, block: Block)
  case class ApplyBlockLocallyResponse(events: List[SemanticEvent])

  object Serialization {

    // common
    implicit def hashEncoder[T]: Encoder[Hash[T]] = Encoder[String].contramap(_.toHexString)
    implicit val proofEncoder: Encoder[Proof] = Encoder[String].contramap(_.value)
    implicit val transitionFunctionCircuitsEncoder: Encoder[TransitionFunctionCircuits] =
      Encoder[Map[String, String]].contramap(_.values)
    implicit val transitionFunctionEncoder: Encoder[TransitionFunction] =
      Encoder[String].contramap(_.value)
    implicit val nonceEncoder: Encoder[Nonce] =
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
      deriveConfiguredEncoder[CallTransaction]
    implicit val deployTxEncoder: Encoder[DeployTransaction] = deriveEncoder
    implicit val txEncoder: Encoder[Transaction] = deriveConfiguredEncoder

    implicit val blockHeightEncoder: Encoder[Block.Height] = Encoder[BigInt].contramap(_.value)
    implicit val blockHeaderEncoder: Encoder[Block.Header] = (h: Block.Header) =>
      JsonObject(
        "blockHash" -> h.hash.asJson,
        "parentBlockHash" -> h.parentHash.asJson,
        "height" -> h.height.asJson,
        "timestamp" -> h.timestamp.asJson,
      ).asJson

    implicit val transactionWithReceiptEncoder: Encoder[TransactionWithReceipt] =
      (transactionWithReceipt: TransactionWithReceipt) =>
        JsonObject(
          "kind" -> "lares".asJson,
          "transaction" -> transactionWithReceipt.transaction.asJson,
          "result" -> JsonObject("type" -> "resultType".asJson).asJson, // FIXME resultType
        ).asJson

    implicit val blockEncoder: Encoder[Block] = (b: Block) =>
      JsonObject(
        "header" -> b.header.asJson,
        "body" -> JsonObject("transactionResults" -> b.transactions.asJson).asJson,
      ).asJson

    implicit val contactSourceEncoder: Encoder[ContractSource] = Encoder[String].contramap(_.value)
    implicit val publicStateEncoder: Encoder[PublicState] = Encoder[String].contramap(_.value)
    implicit val publicTranscriptEncoder: Encoder[PublicTranscript] =
      Encoder[String].contramap(_.value)
    implicit val userIdEncoder: Encoder[UserId] = Encoder[String].contramap(_.value)

    implicit val eventDecoder: Decoder[SemanticEvent] =
      Decoder[Json].map(json => SemanticEvent.apply(json.toString()))
    implicit val publicStateDecoder: Decoder[PublicState] = Decoder[String].map(PublicState.apply)
    implicit val publicTranscriptDecoder: Decoder[PublicTranscript] =
      Decoder[String].map(PublicTranscript.apply)

    implicit val applyBlockLocallyRequestJsonEncodableAsInstanceInstance
        : JsonRpcEncodableAsMethod[ApplyBlockLocallyRequest] = () => "applyBlockLocally"
    implicit val applyBlockLocallyRequestEncoder: Encoder[ApplyBlockLocallyRequest] = deriveEncoder
    implicit val applyBlockLocallyResponseDecoder: Decoder[ApplyBlockLocallyResponse] =
      deriveDecoder

  }

}
