# [Introduction of Blockchain common module instead of Domain]

Technical Story: https://input-output.atlassian.net/browse/NLLW-330

## Context and Problem Statement

The classic `Domain` module had domain classes, interfaces and utils common for different modules, but also parts used only by some specific ones. This module started to couple things too tight.
## Decision Drivers

* Independent modules being coupled too tight.
* Possibility of publishing small modules without unnecessary dependencies.

## Considered Options

* Have a module consisting of blockchain data types (Block, Transaction, etc).
* Don't have a common shared module, but each module would have their own data types.

## Decision Outcome

Chosen option: `module Blockchain`, because `blockchain` domain is the only common part for the whole project, and it fits our needs.

### Positive Consequences

* Less boilerplate code (transforming similar types in some parent module later)
* Possibility to add small reusable code around a codebase
* All our modules depends only on one small module

### Negative Consequences

* Having one common module is tempting for programmers to put there code which is not so reusable in reality, but it makes modules tightly coupled.

## Pros and Cons of the Options

### No shared module

* Good, because all our modules would be independent
* Bad, because it would require duplicating data types around modules and boilerplate to tight them up in possible parent module.
