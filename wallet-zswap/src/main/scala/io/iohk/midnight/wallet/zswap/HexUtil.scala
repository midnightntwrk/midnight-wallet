package io.iohk.midnight.wallet.zswap

import scala.util.{Try, Random}

object HexUtil {
  def encodeHex(bytes: Array[Byte]): String =
    bytes.map(b => String.format("%02x", Integer.valueOf(b & 0xff))).mkString

  def decodeHex(raw: String): Try[Array[Byte]] = Try {
    raw.grouped(2).map(Integer.parseInt(_, 16).toByte).toArray
  }

  def randomHex(): String = {
    val random = new scala.util.Random
    val bytes = new Array[Byte](32)
    random.nextBytes(bytes)
    encodeHex(bytes)
  }
}
