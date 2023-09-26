package io.iohk.midnight.js.interop.util

import io.iohk.midnight.js.interop.util.ArrayOps.*
import munit.ScalaCheckSuite
import org.scalacheck.Prop.forAll

class ArrayOpsSpec extends ScalaCheckSuite {

  test("toUInt8Array is inverse to toByteArray") {
    forAll { (byteArray: Array[Byte]) =>
      val result = byteArray.toUInt8Array.toByteArray
      assert(byteArray.sameElements(result))
    }
  }
}
