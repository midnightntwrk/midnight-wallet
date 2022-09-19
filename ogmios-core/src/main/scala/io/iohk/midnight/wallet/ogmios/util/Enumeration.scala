package io.iohk.midnight.wallet.ogmios.util

import cats.syntax.eq.*
import io.circe.Decoder

/** Temporary support for better enums until we move to Scala 3.
  */
trait Enumeration[T <: Enumeration.Value] {
  def Discriminator: String
  def allValues: Seq[T]

  final def withName(name: String): Either[String, T] =
    allValues
      .find(_.name === name)
      .toRight(s"Invalid value \"$name\" for discriminator \"$Discriminator\"")
}

object Enumeration {
  abstract class Value(val name: String)

  implicit def enumerationDecoder[T <: Enumeration.Value](implicit
      enumeration: Enumeration[T],
  ): Decoder[T] = Decoder[String].emap(enumeration.withName)
}
