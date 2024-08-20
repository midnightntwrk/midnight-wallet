package io.iohk.midnight.wallet.integration_tests
import io.iohk.midnight.wallet.zswap.{LocalState, NetworkId}

object KeyGenerator {
  def main(args: Array[String]): Unit =
    val localState = LocalState()
    println(localState.encryptionSecretKey.serialize(using NetworkId.Undeployed))
}
