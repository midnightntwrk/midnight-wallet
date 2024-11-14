package io.iohk.midnight.wallet.substrate

import io.iohk.midnight.buffer.mod.Buffer
import io.iohk.midnight.wallet.zswap
import io.iohk.midnight.scaleTs.mod.{Vector, compact, u8}
import io.iohk.midnight.js.interop.util.ArrayOps.*
import scala.scalajs.js
import scala.scalajs.js.JSConverters.*

object Serializer {

  def toSubstrateTransaction[Transaction: zswap.Transaction.IsSerializable](
      transaction: Transaction,
  )(using zswap.NetworkId): String = {
    val txAsString =
      Buffer.from(transaction.serialize, "utf8") // no idea why Substrate wants it this way

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
