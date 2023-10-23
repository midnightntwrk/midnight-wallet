# Midnight DApp Connector API

Definition of the Midnight DApp Connector interface.

## Structure

This package declares a set of [TypeScript](https://www.typescriptlang.org/) interfaces. All of them can be found in `src/` directory:
- `api.ts` - To the interface that's exposed to dapps
- `errors.ts` - Errors thrown from the exposed api

## Documentation

To generate documentation files in `docs` folder:

```shell
yarn build:docs
```

## Global Variables Exposure

This package declares a global variable in the `window.midnight.mnLace` scope.

The package needs to be imported in the project or the (typeRoots)[https://www.typescriptlang.org/tsconfig#typeRoots] needs to be configured to load the global variable declaration.
