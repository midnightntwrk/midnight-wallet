# [Lack of mutation tests aka "Stryker""]

- Status: deprecated

## Context and Problem Statement

"Stryker" (https://stryker-mutator.io/docs/stryker4s/getting-started) is a mutation testing framework that other
midnight repositories uses to check correctness of the existing tests. Unfortunately we can't use it because we're using
sbt plugin "sbt-scalajs-crossproject" which doesn't work with Stryker
(https://github.com/stryker-mutator/stryker4s/issues/646).

## Considered Options

- Keep high tests coverage and do care of the tests cases.
- Check if the Stryker bug can be fixed somehow.

## Decision Outcome

There won't be mutation tests in this repository.

### Negative Consequences

- Lack of additional layer of test cases validation.
