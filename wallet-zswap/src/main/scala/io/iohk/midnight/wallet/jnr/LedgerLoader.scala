package io.iohk.midnight.wallet.jnr

import io.iohk.midnight.wallet.jnr.OSUtils.OS
import jnr.ffi.LibraryLoader
import cz.adamh.utils.NativeUtils

import scala.util.Try

object LedgerLoader {

  def loadLedger: Either[String, Ledger] = {
    def loadNativeCode(libName: String): Either[String, Ledger] =
      loadFromJar(libName)
        .orElse(loadFromResource(libName))
        .toEither
        .left
        .map(_.getMessage)

    getLibName.flatMap(loadNativeCode)
  }

  private def loadFromResource(libName: String): Try[Ledger] = Try {
    val path = getClass.getClassLoader.getResource(libName).getPath
    val loader = LibraryLoader.create(classOf[LedgerAPI])
    val loadedLedger = loader.load(path)
    new LedgerImpl(loadedLedger)
  }

  private def loadFromJar(libName: String): Try[Ledger] = Try {
    new LedgerImpl(NativeUtils.loadLibraryFromJar(s"/$libName"))
  }

  private def getLibName: Either[String, String] =
    OSUtils.currentOS() match {
      case OS.Linux   => Right("libmidnight_zswap_jnr.so")
      case OS.Mac     => Right("libmidnight_zswap_jnr.dylib")
      case OS.Windows => Right("libmidnight_zswap_jnr.dll")
      case OS.Other   => Left("Can't load native library file. Unknown OS.")
    }
}
