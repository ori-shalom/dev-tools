#!/usr/bin/env node

import 'ts-node/register/transpile-only';
import chalk from 'chalk';
import { createCommand } from 'commander';
import { packageLambda } from './package';
import { dev } from './dev';
import { start } from './start';
const {version} = require('../package.json');

const defaultConfigFile = 'dt.config.json'
const defaultPort = '3030'

/**
 * Init the CLI commands.
 */
createCommand()
.version(version, '-v, --version')
.name('dt')
.description(`dt is a convenient CLI tool for managing the development lifecycle of TypeScript based AWS Lambda APIs.
It provides opinionated solutions aimed to solve challenges with development and packaging of TypeScript based AWS Lambda for AWS API Gateway.`)
.addCommand(createCommand('dev')
.description(`Run local HTTP server with specified TypeScript lambda APIs in dev mode.
Reload lambda modules with each api call eliminating the need for rebuild or restarting the server for each change.`)
.option('-c, --config-file <file>', 'Config File', defaultConfigFile)
.option('-p, --port <port>', 'Port', defaultPort)
.action(dev))
.addCommand(createCommand('start')
.description(`Run local HTTP server with specified TypeScript lambda APIs.
This command load the lambda modules only once when starting the server and won't be affected by live changes.
While this method works statically compared to the 'dev' command it's still intended to be used locally for development only.
It's main usage is to run the server in a more efficient way when development is focused on frontend.`)
.option('-c, --config-file <file>', 'Config File', defaultConfigFile)
.option('-p, --port <port>', 'Port', defaultPort)
.action(start))
.addCommand(createCommand('package')
.description(`Package an API lambda for deployment.
Transpile the typescript files, perform tree-shaking and bundle to a single minified js file ready to be deployed to AWS.`)
.option('-c, --config-file <file>', 'Config File', defaultConfigFile)
.option('-d, --dist <file>', 'Destination folder to which packages and config JSON are saved')
.action(packageLambda))
.parse(process.argv);
