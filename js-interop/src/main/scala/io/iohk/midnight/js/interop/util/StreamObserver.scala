package io.iohk.midnight.js.interop.util

import cats.effect.IO

private trait StreamObserver[T] {
  def next(value: T): IO[Unit]
  def error(error: Throwable): IO[Unit]
  def complete(): IO[Unit]
}
