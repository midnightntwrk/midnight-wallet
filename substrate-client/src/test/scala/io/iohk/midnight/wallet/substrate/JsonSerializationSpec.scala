package io.iohk.midnight.wallet.substrate

import munit.FunSuite
import io.circe.*
import io.circe.DecodingFailure.Reason.{CustomReason, MissingField}
import io.circe.syntax.*
import JsonSerialization.given
import TransactionExamples.*

class JsonSerializationSpec extends FunSuite {

  test("SubmitTransactionRequest must be serialized to correct JSON RPC request") {
    val req = SubmitTransactionRequest(transaction).asJson

    val expectedReq = Json.obj(
      "id" -> Json.fromInt(1),
      "jsonrpc" -> Json.fromString("2.0"),
      "method" -> Json.fromString("author_submitExtrinsic"),
      "params" -> Json.arr(Json.fromString(serializedTx)),
    )

    assertEquals(req, expectedReq)
  }

  test("SubmitTransactionResponse must be deserialized to JSON RPC result") {
    val extrinsicsHash = "2860cf9e63494b6c06d8f09478fbb16a2d4c564c4af31eac16982c15f55dec15"
    val res = Json
      .obj(
        "id" -> Json.fromInt(1),
        "jsonrpc" -> Json.fromString("2.0"),
        "result" -> Json.fromString(s"0x${extrinsicsHash}"),
      )
      .as[SubmitTransactionResponse]

    res match
      case Right(SubmitTransactionResponse(ExtrinsicsHash(hash))) =>
        assertEquals(hash.toString("hex"), extrinsicsHash)
      case Right(SubmitTransactionResponse(error: RpcError)) => fail(error.message)
      case Left(failure: DecodingFailure)                    => fail(failure.getMessage)
  }

  test("SubmitTransactionResponse must be deserialized to JSON RPC error") {
    val errorCode = 1002
    val errorMessage =
      "Verification Error: Runtime error: Execution failed: Runtime panicked: Bad input data provided to validate_transaction: Invalid transaction version"
    val errorData =
      "RuntimeApi(\"Execution failed: Runtime panicked: Bad input data provided to validate_transaction: Invalid transaction version\")"
    val res = Json
      .obj(
        "id" -> Json.fromInt(1),
        "jsonrpc" -> Json.fromString("2.0"),
        "error" -> Json.obj(
          "code" -> Json.fromInt(errorCode),
          "message" -> Json.fromString(errorMessage),
          "data" -> Json.fromString(errorData),
        ),
      )
      .as[SubmitTransactionResponse]

    res match
      case Right(SubmitTransactionResponse(hash: ExtrinsicsHash)) =>
        fail("result field must be absent")
      case Right(SubmitTransactionResponse(RpcError(code, message, data))) =>
        assertEquals(code, errorCode)
        assertEquals(message, errorMessage)
        assertEquals(data, errorData)
      case Left(failure: DecodingFailure) => fail(failure.getMessage)
  }

  test(
    "Deserializing SubmitTransactionResponse must return Decoding.Failure with MissingField when no result or error fields exist",
  ) {
    val res = Json
      .obj(
        "id" -> Json.fromInt(1),
        "jsonrpc" -> Json.fromString("2.0"),
      )
      .as[SubmitTransactionResponse]

    res match
      case Left(failure: DecodingFailure) => assertEquals(failure.reason, MissingField)
      case _                              => fail("result or error fields must be missing")
  }

  test(
    "Deserializing SubmitTransactionResponse must return Decoding.Failure with CustomReason when both result and error fields exist",
  ) {
    val res = Json
      .obj(
        "id" -> Json.fromInt(1),
        "jsonrpc" -> Json.fromString("2.0"),
        "result" -> Json.fromString(""),
        "error" -> Json.obj(
          "code" -> Json.fromInt(0),
          "message" -> Json.fromString(""),
          "data" -> Json.fromString(""),
        ),
      )
      .as[SubmitTransactionResponse]

    res match
      case Left(failure: DecodingFailure) =>
        assertEquals(failure.reason, CustomReason("One of (result, error) fields must exist"))
      case _ => fail("result and error fields must exist")
  }

}
