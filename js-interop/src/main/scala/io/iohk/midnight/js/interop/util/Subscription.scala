package io.iohk.midnight.js.interop.util

private final case class Subscription[F[_]](start: F[Unit], cancel: F[Unit])
