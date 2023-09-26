package io.iohk.midnight.js.interop.util

import io.iohk.midnight.std.Map as JsMap

import scala.collection.mutable
@SuppressWarnings(Array("org.wartremover.warts.MutableDataStructures"))
object MapOps {
  implicit class FromJSMap[K, V](map: JsMap[K, V]) {
    def valuesList: List[V] = {
      val result = mutable.ArrayBuffer.empty[V]
      map.forEach((value, _, _) => {
        result += value
      })
      result.toList
    }

    def toList: List[(K, V)] = {
      val result = mutable.ArrayBuffer.empty[(K, V)]
      map.forEach((value, key, _) => {
        result += (key -> value)
      })
      result.toList
    }

    def toMap: Map[K, V] = Map.from(map.toList)
  }
}
