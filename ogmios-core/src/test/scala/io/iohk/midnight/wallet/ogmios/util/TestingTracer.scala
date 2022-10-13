package io.iohk.midnight.wallet.ogmios.util

import cats.effect.Sync
import cats.syntax.all.*
import io.iohk.midnight.tracer.Tracer
import scala.collection.mutable

@SuppressWarnings(Array("org.wartremover.warts.MutableDataStructures"))
class TestingTracer[F[_]: Sync, A] extends Tracer[F, A] {

  private val traces: mutable.ListBuffer[A] = mutable.ListBuffer.empty[A]

  override def apply(a: => A): F[Unit] = Sync[F].delay(traces.append(a)).void

  def traced: F[Vector[A]] = Sync[F].delay(traces.toVector)
}
