package io.iohk.midnight.js.interop.util

import io.iohk.midnight.buffer.mod.Buffer

import scala.scalajs.js.JSConverters.*
import scala.scalajs.js.typedarray.Uint8Array

object ArrayOps {
  implicit class FromBytesArray(bytes: Array[Byte]) {
    def toUInt8Array: Uint8Array = {
      Uint8Array.from(bytes.map(_.toShort).toJSArray)
    }
  }

  implicit class FromUInt8Array(bytes: Uint8Array) {
    def toByteArray: Array[Byte] = {
      bytes.map(_.toByte).toArray
    }
  }

  @SuppressWarnings(Array("org.wartremover.warts.AsInstanceOf"))
  implicit class FromBuffer(bytes: Buffer) {
    def toByteArray: Array[Byte] = {
      bytes.asInstanceOf[Uint8Array].toByteArray
    }
  }
}
