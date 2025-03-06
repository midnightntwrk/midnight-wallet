package io.iohk.midnight.wallet.integration_tests

import io.iohk.midnight.wallet.zswap
import io.iohk.midnight.midnightNtwrkZswap.mod
import scala.util.{Success, Failure}

object KeyGenerator {
  def main(args: Array[String]): Unit =
    zswap.HexUtil.decodeHex(
      "0000000000000000000000000000000000000000000000000000000000000001",
    ) match {
      case Success(seed) =>
        val secretKeys = summon[zswap.SecretKeys.CanInit[mod.SecretKeys]].fromSeed(seed)
        print(
          secretKeys.coinPublicKey,
          secretKeys.encryptionPublicKey,
          secretKeys.coinSecretKey,
          secretKeys.encryptionSecretKey,
        )
      case Failure(exception) => println(exception)
    }

  @SuppressWarnings(Array("org.wartremover.warts.TryPartial"))
  def randomSecretKeys(): mod.SecretKeys = {
    val seed = zswap.HexUtil
      .decodeHex(
        zswap.HexUtil.randomHex(),
      )
      .get

    summon[zswap.SecretKeys.CanInit[mod.SecretKeys]].fromSeed(seed)
  }
}
