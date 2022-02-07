package io.iohk.midnight.wallet.domain

/** A typeclass for hashing objects
  */
trait Hashing[F[_]] {
  def calculateHash[T](t: T): F[Hash[T]]
}

object Hashing {
  def apply[F[_]](implicit ev: Hashing[F]): Hashing[F] = ev

  implicit class HashSyntax[F[_], T](t: T)(implicit hashing: Hashing[F]) {
    def calculateHash: F[Hash[T]] = hashing.calculateHash(t)
  }
}
