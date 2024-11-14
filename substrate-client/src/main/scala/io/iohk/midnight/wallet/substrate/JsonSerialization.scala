package io.iohk.midnight.wallet.substrate

import io.circe.*
import io.circe.DecodingFailure.Reason.{CustomReason, MissingField}
import io.iohk.midnight.buffer.mod.Buffer
import io.iohk.midnight.wallet.zswap
import io.iohk.midnight.wallet.zswap.NetworkId

class JsonSerialization[Transaction: zswap.Transaction.IsSerializable] {
  given Encoder[SubmitTransactionRequest[Transaction]] = {
    case SubmitTransactionRequest(tx, networkId) =>
      given NetworkId = networkId
      Json.obj(
        "id" -> Json.fromInt(1),
        "jsonrpc" -> Json.fromString("2.0"),
        "method" -> Json.fromString("author_submitExtrinsic"),
        "params" -> Json.arr(Json.fromString(Serializer.toSubstrateTransaction(tx))),
      )
  }

  given Decoder[RpcError] = (c: HCursor) => {
    for {
      code <- c.downField("code").as[Int]
      message <- c.downField("message").as[String]
      data <- c.downField("data").as[String]
    } yield {
      RpcError(code, message, data)
    }
  }

  given Decoder[SubmitTransactionResponse] = (c: HCursor) => {
    for {
      result <- c.downField("result").as[Option[String]]
      error <- c.downField("error").as[Option[RpcError]]
      response <- decodeResultOrError(result, error, c)
    } yield response
  }

  private def decodeResultOrError(
      result: Option[String],
      error: Option[RpcError],
      c: HCursor,
  ): Decoder.Result[SubmitTransactionResponse] = {
    (result, error) match
      case (Some(hash), None) =>
        Right(
          SubmitTransactionResponse(ExtrinsicsHash(Buffer.from(hash.replaceFirst("0x", ""), "hex"))),
        )
      case (None, Some(error)) => Right(SubmitTransactionResponse(error))
      case (Some(_), Some(_)) =>
        Left(DecodingFailure(CustomReason("One of (result, error) fields must exist"), c))
      case (None, None) => Left(DecodingFailure(MissingField, c))
  }

}
