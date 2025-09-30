# Use [Effect](https://effect.website/)

* Status: accepted
* Deciders: Tim Roberts, Andrzej Kopeć, Monika Jassove
* Date: November 2024

Technical Story: [Wallet Rewrite](https://shielded.atlassian.net/browse/PM-13769)

## Context and Problem Statement

With wallet rewrite to TypeScript, the need to keep internals purely functional remains - it makes testing, specifying and reasoning about code easier, and allows for a more flexible design. There are many approaches towards writing functional code in TypeScript though, with different drawbacks and strong sides. 

## Decision Drivers <!-- optional -->

* Documentation
* Ecosystem
* Overlap with scope of helpers implemented in TS in other projects

## Considered Options

* fp-ts + io-ts + rx.js
* just rx.js + own helpers when needed (maybe extracting from other projects)
* Effect + (maybe) rx.js
* lodash/fp + rx.js

## Decision Outcome

Chosen option: "Effect", because it is the most complete offering at this moment. It is being steadily developed for many years already, has single-shot effects, resource management, streams, schema (successor to io-ts) and a library of common datatypes (successor to fp-ts).  

### Positive Consequences <!-- optional -->

* Single, coherent set of packages to rely on for common operations
* Usage of established library

### Negative Consequences <!-- optional -->

* Need to expose additional flavours of some APIs without referring to Effect

## Pros and Cons of the Options <!-- optional -->

### fp-ts + io-ts + rx.js

* Bad, because of little cohesion
* Bad, because of poor DX

### just rx.js + own helpers when needed (maybe extracting from other projects)

* Good, because it is close to Vanilla JS
* Good, because of reduced number of dependencies
* Bad, because of need to write boilerplate
* Bad, because of lack of important primitives from the day 1 (like typed error handling or resource management)

### lodash/fp + rx.js

As above
