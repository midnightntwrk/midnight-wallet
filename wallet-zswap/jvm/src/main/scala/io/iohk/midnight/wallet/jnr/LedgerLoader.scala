package io.iohk.midnight.wallet.jnr

import io.iohk.midnight.wallet.jnr.OSUtils.OS
import jnr.ffi.LibraryLoader
import cz.adamh.utils.NativeUtils
import scala.util.{Failure, Success, Try}

object LedgerLoader {

  def loadLedger(networkId: Option[NetworkId]): Try[Ledger] =
    getLibName.flatMap(loadNativeCode(_, networkId))

  private def loadNativeCode(libName: String, networkId: Option[NetworkId]): Try[Ledger] =
    loadFromJar(libName, networkId).orElse(loadFromResource(libName, networkId))

  private def loadFromResource(libName: String, networkId: Option[NetworkId]): Try[Ledger] =
    Try {
      val path = getClass.getClassLoader.getResource(libName).getPath
      val loader = LibraryLoader.create(classOf[LedgerAPI])
      val loadedLedger = loader.load(path)
      LedgerImpl(loadedLedger, networkId)
    }

  private def loadFromJar(libName: String, networkId: Option[NetworkId]): Try[Ledger] =
    Try {
      LedgerImpl(NativeUtils.loadLibraryFromJar(s"/$libName"), networkId)
    }

  private def getLibName: Try[String] =
    OSUtils.currentOS() match {
      case OS.Linux   => Success("libmidnight_zswap_jnr.so")
      case OS.Mac     => Success("libmidnight_zswap_jnr.dylib")
      case OS.Windows => Success("libmidnight_zswap_jnr.dll")
      case OS.Other   => Failure(Exception("Can't load native library file. Unknown OS."))
    }
}
