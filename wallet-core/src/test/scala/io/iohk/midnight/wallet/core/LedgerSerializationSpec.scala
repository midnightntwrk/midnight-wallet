package io.iohk.midnight.wallet.core

import cats.Eq
import cats.syntax.eq.*
import io.iohk.midnight.wallet.blockchain.data.ProtocolVersion
import io.iohk.midnight.wallet.zswap.CoinPublicKey
import munit.FunSuite

class LedgerSerializationSpec extends FunSuite {
  private val seed =
    "e9c2cf81bb8522a1ed73ba32d97e9df39bb3b4d7e7154f472e7d0989edeb9c42"

  private val publicKey =
    CoinPublicKey("0361d074be922be7f8f69c45294e5656ca3dce47794df31a0dde259d72aa41c7")

  test("generates state from seed") {
    given Eq[CoinPublicKey] = Eq.fromUniversalEquals

    LedgerSerialization.fromSeed(seed, ProtocolVersion.V1) match {
      case Left(error)  => fail(error.getMessage, error)
      case Right(state) => assert(state.coinPublicKey === publicKey)
    }
  }
}
