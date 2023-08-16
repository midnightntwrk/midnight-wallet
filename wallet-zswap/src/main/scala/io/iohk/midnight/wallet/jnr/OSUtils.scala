package io.iohk.midnight.wallet.jnr

object OSUtils {
  sealed abstract class OS
  object OS {
    case object Linux extends OS
    case object Mac extends OS
    case object Windows extends OS
    case object Other extends OS
  }

  def currentOS(): OS = System.getProperty("os.name") match {
    case "Mac OS X"                                   => OS.Mac
    case "Linux"                                      => OS.Linux
    case str if str.toLowerCase.startsWith("windows") => OS.Windows
    case _                                            => OS.Other
  }
}
