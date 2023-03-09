package io.iohk.midnight.js.interop.util

import cats.effect.IO
import fs2.Stream
import io.iohk.midnight.js.interop.util.ObservableOps.*
import io.iohk.midnight.js.interop.util.StreamOps.*
import munit.CatsEffectSuite

trait StreamOpsFixtures {
  val events: Seq[Int] = Seq.range(0, 100)
  val error = new RuntimeException("error")
  val stream: Stream[IO, Int] = Stream.emits(events)
  val errorStream: Stream[IO, Int] = Stream.emits(events) ++
    Stream.raiseError[IO](error) ++ Stream.emits(events)
}

@SuppressWarnings(Array("org.wartremover.warts.ListAppend"))
class StreamOpsSpec extends CatsEffectSuite with StreamOpsFixtures {

  test("Run stream and get all values from underlying Observable") {
    val sourceObservable = stream.unsafeToObservable()
    val streamFromObservable =
      FromObservable[IO, Int](sourceObservable).toObservableProtocolStream()
    val expectedEvents = events.map(Next(_)).toList :+ Complete

    streamFromObservable.use { stream =>
      assertIO(stream.compile.toList, expectedEvents)
    }
  }

  test(
    "Run stream, offer some events and then on error, stream should finish with some data and error",
  ) {
    val sourceObservable = errorStream.unsafeToObservable()
    val streamFromObservable =
      FromObservable[IO, Int](sourceObservable).toObservableProtocolStream()
    val expectedEvents = events.map(Next(_)).toList :+ Error("error")

    streamFromObservable.use { stream =>
      assertIO(stream.compile.toList, expectedEvents)
    }
  }
}
