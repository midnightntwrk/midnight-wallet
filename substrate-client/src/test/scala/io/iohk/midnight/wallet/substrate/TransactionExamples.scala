package io.iohk.midnight.wallet.substrate

import io.iohk.midnight.midnightNtwrkZswap.mod.{NetworkId, Transaction}
import io.iohk.midnight.buffer.mod.Buffer
import scala.scalajs.js.typedarray.Uint8Array

object TransactionExamples {
  val transactionInBorsh =
    "00040000000000040000000000000000000000000000000000000000"

  @SuppressWarnings(Array("org.wartremover.warts.AsInstanceOf"))
  val transaction: Transaction =
    Transaction.deserialize(
      Buffer.from(transactionInBorsh, "hex").asInstanceOf[Uint8Array],
      NetworkId.Undeployed,
    )

  val serializedTx =
    "f0040500e03030303430303030303030303030303430303030303030303030303030303030303030303030303030303030303030303030303030303030"

}
