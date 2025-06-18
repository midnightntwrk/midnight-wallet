package io.iohk.midnight.js.interop

import scala.scalajs.js
import scala.scalajs.js.annotation.{JSExportAll, JSExportTopLevel}

@JSExportTopLevel("JsEither")
@JSExportAll
object JsEither {
  def fold[A, B, R](
      either: Either[A, B],
      onLeft: js.Function1[A, R],
      onRight: js.Function1[B, R],
  ): R =
    either.fold(onLeft, onRight)

  def right[B](value: B): Either[Any, B] = Right(value)

  def left[A](value: A): Either[A, Any] = Left(value)

  @SuppressWarnings(Array("org.wartremover.warts.Throw"))
  def get[A, B](either: Either[A, B]): B = either match {
    case Left(value)  => throw js.JavaScriptException(s"Called get on left value ${value}")
    case Right(value) => value
  }
}
