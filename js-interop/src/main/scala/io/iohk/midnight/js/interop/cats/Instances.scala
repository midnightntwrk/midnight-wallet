package io.iohk.midnight.js.interop.cats

import cats.{Eval, Foldable, Monoid}
import scala.scalajs.js

object Instances {
  val bigIntSumMonoid: Monoid[js.BigInt] =
    Monoid.instance[js.BigInt](js.BigInt(0), _ + _)

  implicit val arrayFoldable: Foldable[js.Array] =
    new Foldable[js.Array] {
      override def foldLeft[A, B](fa: js.Array[A], b: B)(f: (B, A) => B): B =
        fa.foldLeft(b)(f)

      override def foldRight[A, B](fa: js.Array[A], lb: Eval[B])(
          f: (A, Eval[B]) => Eval[B],
      ): Eval[B] = {
        def loop(as: js.Array[A]): Eval[B] =
          if (as.isEmpty) lb
          else f(as.head, Eval.defer(loop(as.tail)))

        Eval.defer(loop(fa))
      }
    }
}
