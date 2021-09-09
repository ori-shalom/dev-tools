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
This command load the lambda modules only once when starting the server and won't be affected by live changes.
While this method works statically compared to the 'dev' command it's still intended to be used locally for development only.
It's main usage is to run the server in a more efficient way when development is focused on frontend.

**Usage:**

```console
dt start
dt start --config-file dt.config.json --port 3030
dt start -c dt.config.json -p 3030
``` 

### `package`

Package an API lambda for deployment.
Transpile the typescript files, perform tree-shaking and bundle to a single minified js file ready to be deployed to AWS.

**Usage:**

```console
dt package
dt package --config-file dt.config.json --dist dist
dt package -c dt.config.json -d dist
```
