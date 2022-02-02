# Integration tests
Tests that depend on external services so that they are separated from regular unit tests.

## Motivation
An sbt integration test configuration in the root project wouldn't work with Scala.js so this
subproject was needed.

## Dependencies

### External services
As these tests connect with the real external services, the corresponding services must be running
locally and listening to the configured port to which the tests connect. The tests are intentionally
configured to connect to the default port for the service.

Currently, the only external service being tested is platform's node. See 
[midnight-platform](https://github.com/input-output-hk/midnight-platform/) repo to find out how to 
build the docker image and run a container.

### Selenium
There were 2 reasons to choose Selenium as the runtime for integration tests:

1. The Websocket API in Node.js isn't exactly the same as in a browser. Combined with Scala.js plus
the sttp library we're using, it's very cumbersome to access the Websocket API.
2. Wallet target is browsers anyway, so for integration testing it makes sense to test on the real
runtime.

Then to run these integration tests, Selenium drivers must be installed. See [Selenium docs on how to
install](https://www.selenium.dev/documentation/webdriver/getting_started/install_drivers/).
Currently we are only testing Firefox.

## How to run

When dependencies are installed and running, from the root project directory
(`midnight-wallet/impl`), simply use `sbt integrationTests/test`. It will start some browser windows
and automatically close once tests are finished. Test results will be shown in the console as usual.
