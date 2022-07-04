package io.iohk.midnight.wallet.ogmios.tx_submission.util

import cats.syntax.eq.*
import io.circe.Decoder

// [TODO NLLW-361]
private[tx_submission] trait Enumeration[T <: Enumeration.Value] {
  def Discriminator: String
  def allValues: Seq[T]

  final def withName(name: String): Either[String, T] =
    allValues
      .find(_.name === name)
      .toRight(s"Invalid value \"$name\" for discriminator \"$Discriminator\"")
}

private[tx_submission] object Enumeration {
  abstract class Value(val name: String)

  implicit def enumerationDecoder[T <: Enumeration.Value](implicit
      enumeration: Enumeration[T],
  ): Decoder[T] = Decoder[String].emap(enumeration.withName)
}
