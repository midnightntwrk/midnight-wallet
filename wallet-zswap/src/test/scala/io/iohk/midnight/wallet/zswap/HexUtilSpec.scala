package io.iohk.midnight.wallet.zswap

import munit.ScalaCheckSuite
import org.scalacheck.{Gen, Prop}
import scala.util.Success

class HexUtilSpec extends ScalaCheckSuite {
  test("Hex encoding") {
    Prop.forAll(Gen.containerOf[Array, Byte](Gen.choose(Byte.MinValue, Byte.MaxValue))) {
      (raw: Array[Byte]) =>
        val encoded = HexUtil.encodeHex(raw)
        val result = HexUtil.decodeHex(encoded)
        assertEquals(
          result.map(_.toList),
          Success(raw.toList),
          s"Input: ${raw.mkString("[", ", ", "]")} | Encoded: $encoded",
        )
    }
  }
}
