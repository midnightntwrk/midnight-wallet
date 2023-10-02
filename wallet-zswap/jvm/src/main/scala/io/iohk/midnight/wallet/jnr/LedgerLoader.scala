package io.iohk.midnight.wallet.jnr

import io.iohk.midnight.wallet.jnr.OSUtils.OS
import jnr.ffi.LibraryLoader
import cz.adamh.utils.NativeUtils
import scala.util.{Failure, Success, Try}

object LedgerLoader {

  def loadLedger: Try[Ledger] =
    getLibName.flatMap(loadNativeCode)

  private def loadNativeCode(libName: String): Try[Ledger] =
    loadFromJar(libName).orElse(loadFromResource(libName))

  private def loadFromResource(libName: String): Try[Ledger] =
    Try {
      val path = getClass.getClassLoader.getResource(libName).getPath
      val loader = LibraryLoader.create(classOf[LedgerAPI])
      val loadedLedger = loader.load(path)
      LedgerImpl(loadedLedger)
    }

  private def loadFromJar(libName: String): Try[Ledger] =
    Try {
      LedgerImpl(NativeUtils.loadLibraryFromJar(s"/$libName"))
    }

  private def getLibName: Try[String] =
    OSUtils.currentOS() match {
      case OS.Linux   => Success("libmidnight_zswap_jnr.so")
      case OS.Mac     => Success("libmidnight_zswap_jnr.dylib")
      case OS.Windows => Success("libmidnight_zswap_jnr.dll")
      case OS.Other   => Failure(Exception("Can't load native library file. Unknown OS."))
    }
}
