package io.iohk.midnight.wallet.zswap

import scala.util.Try

object HexUtil {
  def encodeHex(bytes: Array[Byte]): String =
    bytes.map(b => String.format("%02x", Integer.valueOf(b & 0xff))).mkString

  def decodeHex(raw: String): Try[Array[Byte]] = Try {
    raw.grouped(2).map(Integer.parseInt(_, 16).toByte).toArray
  }
}
