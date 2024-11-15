package io.iohk.midnight.js.interop.util

import cats.effect.IO

private final case class Subscription(start: IO[Unit], cancel: IO[Unit])
