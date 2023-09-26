package io.iohk.midnight.wallet.substrate

import munit.FunSuite
import TransactionExamples.*

class SerializerSpec extends FunSuite {

  test(
    "Serializer must serialize transaction to substrate format (using SCALE codec with metadata prefix)",
  ) {
    assertEquals(Serializer.toSubstrateTransaction(transaction), serializedTx)
  }

}
