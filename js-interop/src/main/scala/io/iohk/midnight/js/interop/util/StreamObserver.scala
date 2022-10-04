package io.iohk.midnight.js.interop.util

private trait StreamObserver[F[_], T] {
  def next(value: T): F[Unit]
  def error(error: Throwable): F[Unit]
  def complete(): F[Unit]
}
