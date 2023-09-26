package io.iohk.midnight.js.interop.util

import scala.scalajs.js

object BigIntOps {
  extension (b: BigInt) {
    @SuppressWarnings(Array("org.wartremover.warts.ToString"))
    def toJsBigInt: js.BigInt = js.BigInt(b.toString())
  }

  extension (b: js.BigInt) {
    @SuppressWarnings(Array("org.wartremover.warts.ToString"))
    def toScalaBigInt: BigInt = BigInt(b.toString())
  }
}
