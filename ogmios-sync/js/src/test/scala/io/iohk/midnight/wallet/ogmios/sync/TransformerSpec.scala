package io.iohk.midnight.wallet.ogmios.sync

import io.circe.Json
import io.circe.syntax.*
import io.iohk.midnight.wallet.ogmios.util.BetterOutputSuite
import munit.FunSuite
import scala.scalajs.js

class TransformerSpec extends FunSuite with BetterOutputSuite {
  test("Should transform all properties") {
    val transformed = Transformer.dynamicFromJson(
      Json.obj(
        "null" := Json.Null,
        "boolean" := true,
        "number" := 1,
        "string" := "Some string",
        "array" := Json.arr(1.asJson),
      ),
    )

    @SuppressWarnings(Array("org.wartremover.warts.Null"))
    val expected = js.Dynamic.literal(
      `null` = null,
      boolean = true,
      number = 1,
      string = "Some string",
      array = js.Array(1),
    )

    assertEquals(js.JSON.stringify(transformed), js.JSON.stringify(expected))
  }
}
