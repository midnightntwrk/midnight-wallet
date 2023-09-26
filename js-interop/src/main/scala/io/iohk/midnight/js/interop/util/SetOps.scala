package io.iohk.midnight.js.interop.util

import io.iohk.midnight.std.Set

import scala.collection.mutable

object SetOps {
  implicit class FromJSSet[T](set: Set[T]) {
    def toList: List[T] = {
      @SuppressWarnings(Array("org.wartremover.warts.MutableDataStructures"))
      val result = mutable.ArrayBuffer.empty[T]
      set.forEach((value, _, _) => {
        result += value
      })
      result.toList
    }
  }
}
