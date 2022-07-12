package io.iohk.midnight.wallet.core.services

import cats.Functor
import cats.syntax.functor.*
import io.iohk.midnight.wallet.blockchain.data.Block
import io.iohk.midnight.wallet.core.clients.lares.LaresClient
import io.iohk.midnight.wallet.core.clients.lares.LaresClientProtocol.ApplyBlockLocallyRequest
import io.iohk.midnight.wallet.core.domain.{SemanticEvent, TransactionRequest, UserId}

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
