package io.iohk.midnight.wallet.integration_tests

import io.iohk.midnight.wallet.zswap.given
import io.iohk.midnight.wallet.zswap
import io.iohk.midnight.midnightNtwrkZswap.mod

object KeyGenerator {
  def main(args: Array[String]): Unit =
    given zswap.NetworkId = zswap.NetworkId.Undeployed
    val localState = summon[zswap.LocalState.IsSerializable[mod.LocalState]].create()
    println(
      localState
        .yesIKnowTheSecurityImplicationsOfThis_encryptionSecretKey()
        .serialize,
    )
}
