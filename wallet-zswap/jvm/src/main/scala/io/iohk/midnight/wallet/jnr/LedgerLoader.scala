package io.iohk.midnight.wallet.jnr

import cats.syntax.eq.*
import io.iohk.midnight.wallet.jnr.SystemUtils.{Architecture, OS, currentOS}
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

  private def getLibName: Try[String] = {
    val currentArch = SystemUtils.currentArchitecture
    val currentOs = SystemUtils.currentOS
    if (currentArch === Architecture.Other || currentOS === OS.Other) {
      Failure(Exception("Can't load native library file. Unknown OS/Architecture."))
    } else {
      val dir = s"zswap-c-bindings_${currentArch.name}-${currentOs.name}"
      val file = s"libmidnight_zswap_c_bindings.${currentOs.extension}"
      Success(s"$dir/$file")
    }
  }
}
