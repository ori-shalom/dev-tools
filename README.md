# Dev Tools

`dt` is a convenient CLI tool for managing the development lifecycle of TypeScript based AWS Lambda APIs.
It provides opinionated solutions aimed to solve challenges with development and packaging of TypeScript based AWS Lambda for AWS API Gateway.

## Commands:

### `dev`

Run local HTTP server with specified TypeScript lambda APIs in dev mode.
Reload lambda modules with each api call eliminating the need for rebuild or restarting the server for each change.

**Usage:**

```console
dt dev
dt dev --config-file dt.config.json --port 3030
dt dev -c dt.config.json -p 3030
```

### `start`

Run local HTTP server with specified TypeScript lambda APIs.
This command load the lambda API modules only once when starting the server and won't be affected by live changes.
While this method works statically compared to the `dev` command it's still intended to be used locally for development only.
Its main usage is to run the server in a more efficient way when development is focused on frontend and fewer changes are done to the API.

**Usage:**

```console
dt start
dt start --config-file dt.config.json --port 3030
dt start -c dt.config.json -p 3030
``` 

### `package`

Create an API package ready for deployment from a TypeScript Lambda API module.
- Transpile the typescript code
- Perform tree-shaking
- Exclude `aws-sdk` (included in lambda environment)
- Bundle to a single minified JS file
- Include additional assets (binaries that can't be bundled in the JS)
- Package the result into a ZIP file ready to be deployed to AWS.

**Usage:**

```console
dt package
dt package --config-file dt.config.json --dist dist
dt package -c dt.config.json -d dist
```
