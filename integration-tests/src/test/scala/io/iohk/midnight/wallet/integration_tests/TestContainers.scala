package io.iohk.midnight.wallet.integration_tests

import cats.effect.{IO, Resource}
import io.iohk.midnight.testcontainers.buildMod.GenericContainer
import io.iohk.midnight.testcontainers.buildTestContainerMod.StartedTestContainer

object TestContainers {
  def resource(dockerImage: String)(
      config: GenericContainer => GenericContainer,
  ): Resource[IO, StartedTestContainer] =
    Resource.make(
      IO.fromPromise(IO.delay(config(new GenericContainer(dockerImage)).start())),
    )(container => IO.fromPromise(IO.delay(container.stop())).void)
}
