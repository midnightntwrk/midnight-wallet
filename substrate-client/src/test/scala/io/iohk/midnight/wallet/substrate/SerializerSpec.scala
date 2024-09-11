package io.iohk.midnight.wallet.substrate

import munit.FunSuite
import TransactionExamples.*
import io.iohk.midnight.wallet.zswap.{NetworkId, Transaction}

class SerializerSpec extends FunSuite {

  test(
    "Serializer must serialize transaction to substrate format (using SCALE codec with metadata prefix)",
  ) {
    given NetworkId = NetworkId.Undeployed
    assertEquals(Serializer.toSubstrateTransaction(Transaction.fromJs(transaction)), serializedTx)
  }

}
