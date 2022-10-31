package io.iohk.midnight.wallet.engine.services

import cats.effect.Resource
import cats.effect.kernel.Sync
import typings.midnightMockedNodeInMemoryServer.anon.PartialConfig
import typings.midnightMockedNodeInMemoryServer.anon.PartialConfig.PartialConfigMutableBuilder
import typings.midnightMockedNodeInMemoryServer.inMemoryServerMod.InMemoryServer

object InMemoryServerResource {

  @SuppressWarnings(Array("org.wartremover.warts.NonUnitStatements"))
  def acquire[F[_]: Sync](
      config: NodeConfig,
  ): Resource[F, Unit] = {
    val partialConfig = PartialConfig()
      .setHost(config.host)
      .setPort(config.port.toDouble)

    val acquireServer = Sync[F].delay(new InMemoryServer(partialConfig))
    val releaseServer = (server: InMemoryServer) => Sync[F].delay(server.run())

    Resource.make(acquireServer)(releaseServer).map(_.run())
  }

  final case class NodeConfig(host: String, port: Int)
}
