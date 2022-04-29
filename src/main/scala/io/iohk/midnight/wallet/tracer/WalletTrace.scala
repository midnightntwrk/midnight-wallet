package io.iohk.midnight.wallet.tracer

import io.iohk.midnight.wallet.tracer.WalletTrace.Level

trait WalletTrace {
  def level: Level
  def message: String
  def context: Map[String, String] = Map.empty
}

object WalletTrace {
  sealed trait Level
  object Level {
    case object Error extends Level
    case object Warn extends Level
    case object Info extends Level
    case object Debug extends Level
    case object Trace extends Level
  }
}
