# Use Markdown Architectural Decision Records

## Context and Problem Statement

Traditional architecture with interfaces and services is not flexible when comes to designing different types of wallet with different capabilities. Adding new type of wallet result with obligation to adapt all services to support it. We want to avoid it and have a simple way to support new wallet types.

## Considered Options

* Traditional architecture with interfaces and services
* Abstraction over Wallet type and wallet capabilities described by type classes

## Decision Outcome

Chosen option: `Abstraction over Wallet type`, because it will gives us flexibility for quickly preparing new wallet types.

### Positive Consequences

* Services are abstracted over wallet type - no need to adapt them to different wallet types
* Adding new wallet by just implementing its data container and capability type classes

### Negative Consequences

* Higher entry threshold than traditional design
* Services are abstracted over wallet type - operations on the wallet are not available from scratch
* Possibility of necessary adoption of future typescript code due to usage of implicit arguments by wallet builder (wallet as a library)

### Example
New approach

Visible characteristics:
- Wallet is only a container for data
- Capabilities implementations can be instantiated and tested separately
- Capabilities implementations are provided to service implicitly by compiler

```scala
trait BlockProcessing[Wallet] {
  def applyBlock(wallet: Wallet, block: Block): Wallet
}

case class SimpleWallet private (state: LocalState)

object SimpleWallet {
  implicit val blockProcessing: BlockProcessing[SimpleWallet] = new BlockProcessing[SimpleWallet] {
    override def applyBlock(wallet: SimpleWallet, block: Block): SimpleWallet = SimpleWallet(state.apply(block))
  }
}

object SyncService {
  def handleBlocks[W: BlockProcessing](wallet: W, blocks: Stream[Block]): Stream[W] = {
    blocks.scanLeft(wallet) {
      (wallet, block) => implicitly[BlockProcessing[W]].applyBlock(wallet, block)
    }
  }
}
```

Traditional approach

Visible characteristics:
- Wallet is a container and service
- Composing more capabilities requires creating one super wallet-service implementation
- Capabilities implementations are provided to service explicitly

```scala
trait BlockProcessing[Wallet] {
  def applyBlock(block: Block): Wallet
}

case class SimpleWallet private (state: LocalState) extends BlockProcessing[SimpleWallet] {
  override def applyBlock(block: Block): SimpleWallet = SimpleWallet(state.apply(block))
}

class SyncService[W <: BlockProcessing[W]](wallet: W) {
  def handleBlocks(blocks: Stream[Block]): Stream[W] = {
    blocks.scanLeft(wallet) {
      (wallet, block) => wallet.applyBlock(block)
    }
  }
}
```