# Use TSC to build projects

- Status: proposed
- Deciders: Ian Gregson, Tim Roberts, Andrzej Kopeć, Agron Murtezi
- Date: July 2025

Technical Story: [PM-18147](https://shielded.atlassian.net/browse/PM-18147) <!-- optional -->

## Context and Problem Statement

Our projects are written in TypeScript to leverage type safety and improve developer productivity through IDE features
like "Go to Implementation" (e.g., Cmd+Click in VS Code).

Previously, we used Rollup to bundle our TypeScript code, but this caused issues where navigating to a symbol’s
implementation in the IDE opened the generated .d.ts declaration file instead of the source .ts file, despite generating
declaration maps (.d.ts.map).

This is because Rollup consolidates type declarations into a single index.d.ts file per project and bundles all .ts
files into a single .js file, breaking the source mapping for IDE navigation.

How can we configure our build process to ensure accurate IDE navigation to source files while maintaining TypeScript’s
benefits?

## Decision Drivers <!-- optional -->

- Developer experience, particularly accurate IDE navigation to source files
- Compatibility with TypeScript’s ecosystem and declaration maps
- Build performance and scalability
- Maintainability and simplicity of the build configuration

## Considered Options

- Continue using Rollup and try and fix the issue
- Use TypeScript Compiler (tsc) for building

## Decision Outcome

Chosen option: "Use TypeScript Compiler (tsc)", because it generates individual .d.ts and .d.ts.map files for each
source file, ensuring accurate IDE navigation to the original .ts files. It also provides the most robust integration
with TypeScript’s type system and declaration map features, improving developer productivity.

### Positive Consequences <!-- optional -->

- Improved IDE navigation: Cmd+Click reliably navigates to source .ts files
- Better alignment with TypeScript’s native tooling, reducing configuration complexity
- Enhanced maintainability due to standardized build process
- Incremental builds enabled by the composite setting in tsconfig.json, which generates a tsconfig.build.tsbuildinfo
  file, caching build information and skipping recompilation of unchanged source files for faster subsequent builds

### Negative Consequences <!-- optional -->

- Scala needs to read our existing Typescript code, it currently imports `address-format` and `capabilities`.
  Capabilities has multiple source files and the Scala generation requires that all javascript files are consolidated
  together and all types are consolidated together. Hence, capabilities requires us to maintain it's use of rollup.
  These issues will disppear shortly when Scala goes away.

## Pros and Cons of the Options <!-- optional -->

### Continue using Rollup with declaration maps

- Bad, needed to edit the package.json and have the types point to the actual typescript source files
- Bad, needed to introduce an additional `publish` directory to support a modified version of package.json for
  publishing
- Bad, needed to have the .d.ts file saved into the `publish` directory, otherwise it caused an IDE conflict if left in
  the `dist` directory
