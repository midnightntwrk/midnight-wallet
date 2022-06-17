package io.iohk.midnight.wallet.services

import cats.Functor
import cats.syntax.functor.*
import io.iohk.midnight.wallet.clients.lares.LaresClient
import io.iohk.midnight.wallet.clients.lares.LaresClientProtocol.ApplyBlockLocallyRequest
import io.iohk.midnight.wallet.domain.{Block, SemanticEvent, TransactionRequest, UserId}

trait LaresService[F[_]] {
  def applyBlock(block: Block): F[(Seq[SemanticEvent], Seq[TransactionRequest])]
}

object LaresService {
  class Live[F[_]: Functor](userId: UserId, laresClient: LaresClient[F]) extends LaresService[F] {
    override def applyBlock(block: Block): F[(Seq[SemanticEvent], Seq[TransactionRequest])] =
      laresClient
        .applyBlockLocally(ApplyBlockLocallyRequest(userId, block))
        .map(response => (response.events, response.transactionRequests))
  }
}
