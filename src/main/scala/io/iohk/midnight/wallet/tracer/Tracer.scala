package io.iohk.midnight.wallet.tracer

import cats.{Applicative, Contravariant, FlatMap, Monad, Monoid, Show, Traverse, ~>}
import cats.syntax.apply.*
import cats.syntax.applicative.*
import cats.syntax.foldable.*
import cats.syntax.functor.*
import cats.syntax.flatMap.*

/** Contravariant tracer
  *
  * It behaves a bit like Kleisli[F, A, Unit] with 2 differences:
  *   - it is lazy on A - does not evaluate it's parameter if not used
  *   - returning unit means we can ignore "the output" and define rich API
  *
  * Ported from https://github.com/input-output-hk/contra-tracer/blob/master/src/Control/Tracer.hs
  */
trait Tracer[F[_], -A] {
  def apply(a: => A): F[Unit]
}

object Tracer {

  /** If you know:
    *   - how to enrich type A that is traced
    *   - how to squeeze B's to create A's (possibly enrich B with extra stuff, or forget some
    *     details) then you have Tracer for B
    */
  implicit def contraTracer[F[_]]: Contravariant[Tracer[F, *]] =
    new Contravariant[Tracer[F, *]] {
      override def contramap[A, B](fa: Tracer[F, A])(f: B => A): Tracer[F, B] = new Tracer[F, B] {
        override def apply(a: => B): F[Unit] = fa(f(a))
      }
    }

  def noOpTracer[M[_]: Applicative, A]: Tracer[M, A] = new Tracer[M, A] {
    override def apply(a: => A): M[Unit] = ().pure
  }

  implicit def monoidTracer[F[_], S](implicit MA: Applicative[F]): Monoid[Tracer[F, S]] =
    new Monoid[Tracer[F, S]] {

      /** Run sequentially two tracers */
      override def combine(a1: Tracer[F, S], a2: Tracer[F, S]): Tracer[F, S] =
        s => a1(s) *> a2(s)

      override def empty: Tracer[F, S] = noOpTracer
    }

  /** Trace value a using tracer tracer */
  def traceWith[F[_], A](tracer: Tracer[F, A], a: A): F[Unit] = tracer(a)

  /** contravariant Kleisli composition: if you can:
    *   - produce effect M[B] from A
    *   - trace B's then you can trace A's
    */
  def contramapM[F[_]: FlatMap, A, B](f: A => F[B], tracer: Tracer[F, B]): Tracer[F, A] = {
    new Tracer[F, A] {
      override def apply(a: => A): F[Unit] =
        f(a) >>= (tracer(_))
    }
  }

  /** change the effect F to G using natural transformation nat */
  def natTracer[F[_], G[_], A](nat: F ~> G, tracer: Tracer[F, A]): Tracer[G, A] =
    a => nat(tracer(a))

  /** filter out values to trace if they do not pass predicate p */
  def condTracing[F[_]: Applicative, A](pred: A => Boolean, tr: Tracer[F, A]): Tracer[F, A] = {
    new Tracer[F, A] {
      override def apply(a: => A): F[Unit] =
        if (pred(a)) tr(a)
        else ().pure
    }
  }

  /** filter out values that was send to trace using side effecting predicate */
  def condTracingM[F[_]: Monad, A](p: F[A => Boolean], tr: Tracer[F, A]): Tracer[F, A] =
    a => p.flatMap(condTracing(_, tr).apply(a))

  def showTracing[F[_], A: Show](tracer: Tracer[F, String])(implicit
      C: Contravariant[Tracer[F, *]],
  ): Tracer[F, A] =
    C.contramap(tracer)(Show[A].show)

  def traceAll[A, B, G[_]: FlatMap](f: B => G[A], t: Tracer[G, A]): Tracer[G, B] =
    new Tracer[G, B] {
      override def apply(event: => B): G[Unit] = f(event).flatMap(t(_))
    }
}

object TracerSyntax {

  implicit class TracerOps[F[_], A](val tracer: Tracer[F, A]) extends AnyVal {

    /** Trace value a using tracer tracer */
    def trace(a: A): F[Unit] = tracer(a)

    /** contravariant Kleisli composition: if you can:
      *   - produce effect M[B] from A
      *   - trace B's then you can trace A's
      */
    def >=>[B](f: B => F[A])(implicit MM: FlatMap[F]): Tracer[F, B] =
      Tracer.contramapM(f, tracer)

    def nat[G[_]](nat: F ~> G): Tracer[G, A] =
      Tracer.natTracer(nat, tracer)

    def filter(p: A => Boolean)(implicit FM: Applicative[F]): Tracer[F, A] =
      Tracer.condTracing[F, A](p, tracer)

    def filterNot(p: A => Boolean)(implicit FM: Applicative[F]): Tracer[F, A] =
      filter(a => !p(a))

    def filterM(p: F[A => Boolean])(implicit FM: Monad[F]): Tracer[F, A] =
      Tracer.condTracingM(p, tracer)

    def traceAll[B, G[_]: Traverse](f: B => G[A])(implicit FM: Applicative[F]): Tracer[F, B] =
      new Tracer[F, B] {
        override def apply(event: => B): F[Unit] =
          f(event).map(trace).foldA
      }
  }
}
