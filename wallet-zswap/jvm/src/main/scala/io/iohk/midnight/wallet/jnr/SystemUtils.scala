package io.iohk.midnight.wallet.jnr
import cats.Eq

object SystemUtils {
  enum OS(val name: String, val extension: String) {
    case Linux extends OS("linux", "so")
    case Mac extends OS("darwin", "dylib")
    case Other extends OS("other", "other")
  }
  object OS {
    given Eq[OS] = Eq.fromUniversalEquals
  }

  def currentOS: OS = System.getProperty("os.name") match {
    case "Mac OS X" => OS.Mac
    case "Linux"    => OS.Linux
    case _          => OS.Other
  }

  enum Architecture(val name: String) {
    case Aarch64 extends Architecture("aarch64")
    case Amd64 extends Architecture("x86_64")
    case Other extends Architecture("other")
  }
  object Architecture {
    given Eq[Architecture] = Eq.fromUniversalEquals
  }

  def currentArchitecture: Architecture = System.getProperty("os.arch") match {
    case "aarch64" => Architecture.Aarch64
    case "amd64"   => Architecture.Amd64
    case _         => Architecture.Other
  }
}
