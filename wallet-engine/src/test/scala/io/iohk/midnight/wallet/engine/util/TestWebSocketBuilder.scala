package io.iohk.midnight.wallet.engine.util

import cats.syntax.all.*
import org.http4s.ember.server.EmberServerBuilder
import cats.effect.kernel.Async
import cats.effect.kernel.Resource
import org.http4s.server.Server
import com.comcast.ip4s.Port
import org.http4s.HttpRoutes
import org.http4s.dsl.Http4sDsl
import org.http4s.server.websocket.WebSocketBuilder2
import org.http4s.websocket.WebSocketFrame
import fs2.Pipe
import cats.effect.kernel.Ref

object TestWebSocketBuilder {

  def build[F[_]: Async](port: Port): Resource[F, CountingEchoServer[F]] = {
    Resource.eval(Ref[F].of(0)).flatMap { counter =>
      val server = new CountingEchoServer(port, counter)
      server.build.as(server)
    }
  }

  class CountingEchoServer[F[_]: Async](port: Port, val msgCounter: Ref[F, Int]) {

    def build: Resource[F, Server] = {
      val routes = new Routes
      EmberServerBuilder
        .default[F]
        .withPort(port)
        .withHttpWebSocketApp(routes.routes(_).orNotFound)
        .build
    }

    private class Routes() extends Http4sDsl[F] {
      def routes(wsb: WebSocketBuilder2[F]): HttpRoutes[F] =
        HttpRoutes.of[F] { case GET -> Root =>
          def process(wsfStream: fs2.Stream[F, WebSocketFrame]): fs2.Stream[F, WebSocketFrame] = {
            val in: fs2.Stream[F, String] =
              wsfStream
                .collect { case WebSocketFrame.Text(msg, _) =>
                  msg
                }
            in.evalTap(_ => incrCounter).map(WebSocketFrame.Text(_))
          }
          def incrCounter: F[Unit] = msgCounter.update(_ + 1)
          val sendReceive: Pipe[F, WebSocketFrame, WebSocketFrame] = process
          wsb.build(sendReceive)
        }
    }

  }

}
