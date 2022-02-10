package io.iohk.midnight.wallet.services

import cats.effect.IO
import cats.effect.std.Random
import io.iohk.midnight.wallet.util.BetterOutputSuite
import munit.{CatsEffectSuite, ScalaCheckEffectSuite}
import org.scalacheck.Gen
import org.scalacheck.effect.PropF.forAllF

class UserIdGeneratorSpec
    extends CatsEffectSuite
    with ScalaCheckEffectSuite
    with BetterOutputSuite {
  test("generate a UserId") {
    val random = Random.scalaUtilRandom[IO]

    forAllF(Gen.posNum[Int]) { idLength =>
      random.flatMap { implicit random =>
        UserIdGenerator.generate[IO](idLength).map { userId =>
          assertEquals(userId.value.length, idLength)
          assert(userId.value.forall(_.isLetterOrDigit))
        }
      }
    }
  }
}
