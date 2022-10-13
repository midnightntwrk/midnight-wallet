# JS modules resolution

## Context and Problem Statement

Wallet is using libraries written in Typescript as ESM modules (Wallet-API). Until Node 16 that type of modules needs to have imports with full path with file extensions (`ECMAScript module loader: It does no extension searching. A file extension must be provided when the specifier is a relative or absolute file URL.` taken from https://nodejs.org/api/packages.html#packages_determining_module_system).
Unfortunately, ScalablyTyped is generating scalaJS code with imports without file extension. That code can't be run in our test Node environment. 

## Considered Options

* Contribution to ScalablyTyped (https://github.com/ScalablyTyped/Converter/issues/476)
* Quick fix for ScalablyTyped only for our internal usage
* Rewrite all our libraries as CommonJS modules
* Use `--experimental-specifier-resolution=node` flag to disable full path module resolution and run code on the Node (https://nodejs.org/docs/latest-v16.x/api/esm.html#customizing-esm-specifier-resolution-algorithm)

## Decision Outcome

Chosen option: "using module resolution flag by Node", because it is the simplest and fastest solution at this moment.
We will consider "contribution to ScalablyTyped" in the future.

## Pros and Cons of the Options

### Contribution to ScalablyTyped

* Good, because it fixes source of the problem
* Good, because contribution to the open source is always valuable
* Bad, because it needs time and resources to do it properly and in cooperation with library owner

### Quick internal fix for ScalablyTyped

* Good, because it can fix quickly source of the problem
* Bad, because it needs time and resources
* Bad, because without domain knowledge we can introduce new bugs

### Rewrite libraries as CommonJS modules

* Good, because resolution of CommonJS modules is simpler
* Bad, because CommonJS modules are not supported by browsers directly (but can be used packed by bundlers)
* Bad, because we can't use ESM modules easily inside CommonJS module (they need to be properly initialized)

### Use `--experimental-specifier-resolution=node` flag

* Good, because it works
* Bad, because we need to remember to always use this flag
* Bad, because the flag will be removed in future
