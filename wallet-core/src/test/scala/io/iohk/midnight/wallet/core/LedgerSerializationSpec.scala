package io.iohk.midnight.wallet.core

import cats.Eq
import cats.syntax.eq.*
import io.iohk.midnight.wallet.zswap.CoinPublicKey
import munit.FunSuite

class LedgerSerializationSpec extends FunSuite {
  private val seed =
    "e9c2cf81bb8522a1ed73ba32d97e9df39bb3b4d7e7154f472e7d0989edeb9c42"

  private val publicKey =
    CoinPublicKey("411c0c671563eb74173179e7dd976c12c59d1468d7408a5b03e478cf8aae9d70")

  test("generates state from seed") {
    given Eq[CoinPublicKey] = Eq.fromUniversalEquals

    LedgerSerialization.fromSeed(seed) match {
      case Left(error)  => fail(error.getMessage, error)
      case Right(state) => assert(state.coinPublicKey === publicKey)
    }
  }
}
