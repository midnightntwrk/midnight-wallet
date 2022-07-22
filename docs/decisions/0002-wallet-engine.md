# [Introduction of parent module Wallet-Engine]

Technical Story: https://input-output.atlassian.net/browse/NLLW-330

## Context and Problem Statement

Currently `wallet-core`, the module which is describing the wallet, its builder and all needed interfaces, must have a dependency to modules which are implementing those interfaces. It is not optimal, as a main goal of this module is to implement wallet behaviour **only** - knowing about implementation details of its dependencies is not needed at all. That situation creates need for new way of linking things together.
## Decision Drivers

* Possibility to develop wallet without basing on implementations details taken from external libraries
* Possibility of publishing small modules without unnecessary dependencies.

## Considered Options

* New "parent" module which only responsibility is linking all modules together
* Rich `wallet-core` module, which besides developing wallet also links all modules together

## Decision Outcome

Chosen option: `new parent module`, because it fits our policy of having small independent modules of one purpose.

### Positive Consequences

* `wallet-core` module can focus only on developing wallet behaviour
* Evolution of other modules won't mess in wallet

### Negative Consequences

* Another extra module
* Demand to implementing wallet interfaces adapters
