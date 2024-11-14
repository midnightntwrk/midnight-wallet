package io.iohk.midnight.wallet.core

import cats.Eq
import cats.syntax.eq.*
import io.iohk.midnight.midnightNtwrkZswap.mod.*
import munit.FunSuite

class LedgerSerializationSpec extends FunSuite {
  private val seed =
    "e9c2cf81bb8522a1ed73ba32d97e9df39bb3b4d7e7154f472e7d0989edeb9c42"

  private val publicKey =
    "0361d074be922be7f8f69c45294e5656ca3dce47794df31a0dde259d72aa41c7"

  private val ledgerSerialization =
    new LedgerSerialization[LocalState, Transaction]

  test("generates state from seed") {
    ledgerSerialization.fromSeed(seed) match {
      case Left(error)  => fail(error.getMessage, error)
      case Right(state) => assert(state.coinPublicKey === publicKey)
    }
  }
}
