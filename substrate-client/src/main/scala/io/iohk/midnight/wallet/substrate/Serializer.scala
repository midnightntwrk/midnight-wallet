package io.iohk.midnight.wallet.substrate

import io.iohk.midnight.buffer.mod.Buffer
import io.iohk.midnight.midnightZswap.mod.Transaction
import io.iohk.midnight.scaleTs.mod.{Vector, compact, u8}
import io.iohk.midnight.js.interop.util.ArrayOps.*

import scala.scalajs.js
import scala.scalajs.js.JSConverters.*

object Serializer {

  def toSubstrateTransaction(transaction: Transaction): String = {
    val txAsBorsh = Buffer.from(transaction.serialize()).toString("hex")
    val txAsString = Buffer.from(txAsBorsh, "utf8") // no idea why Substrate wants it this way

    val encodedTx = Vector(u8).enc(txAsString.toByteArray.map(_.toDouble).toJSArray)
    val encodedTxVersion = u8.enc(4)
    val encodedPallet = u8.enc(5) // midnight pallet index = 5
    val encodedMethod = u8.enc(0) // submit method index = 0
    val dataLength =
      encodedTxVersion.byteLength + encodedPallet.byteLength + encodedMethod.byteLength + encodedTx.byteLength
    val encodedLength = compact.enc(dataLength)
    Buffer
      .concat(js.Array(encodedLength, encodedTxVersion, encodedPallet, encodedMethod, encodedTx))
      .toString("hex")
  }

}
