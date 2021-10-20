import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { APIGatewayProxyStructuredResultV2 } from 'aws-lambda/trigger/api-gateway-proxy';
import express, { ErrorRequestHandler, Handler, raw, Request, Response, Router } from 'express';
import { PartialDeep } from 'type-fest';
import { decode } from 'jsonwebtoken';


/**
 * An adapter that behave as an express handler that wrap internally an AWS Lambda handler.
 * @param {(event: PartialDeep<APIGatewayProxyEventV2>) => Promise<APIGatewayProxyStructuredResultV2>} lambdaHandler
 * @returns {e.Handler}
 */
export function lambdaAsExpressHandler(lambdaHandler: (event: PartialDeep<APIGatewayProxyEventV2>) => Promise<APIGatewayProxyStructuredResultV2>): Handler {
  return async (req, res) => {
    sendExpressResponseFromLambdaResult(res, await lambdaHandler(expressRequestAsLambdaEvent(req)))
  }
}

/**
 * Compose AWS Lambda Event object from an express request.
 * @param request
 * @return {{isBase64Encoded: boolean, headers: any, pathParameters: {proxy: any}, requestContext: {http: {path: string, method: string}}, queryStringParameters: any, body: string}}
 */
export function expressRequestAsLambdaEvent(request: Request): PartialDeep<APIGatewayProxyEventV2> {
  const { token } = request.headers.authorization?.match(/^Bearer (?<token>.*)$/)?.groups ?? {};
  const rawClaims = token ? decode(token, { json: true }) ?? {} : {}
  const claims = {
    ...rawClaims,
    ...(rawClaims?.['cognito:groups'] ? { ['cognito:groups']: '['+rawClaims?.['cognito:groups'].join(' ')+']' } : {}),
    ...Object.entries(rawClaims ?? {}).filter(([,value]) => typeof value === 'boolean').reduce((c, [key, value]) => ({...c, [key]: String(value)}), {})
  }
  return {
    isBase64Encoded: !request.is('application/json'),
    headers: Object.entries(request.headers).reduce((headers, [k, v]) => ({...headers, [k]: Array.isArray(v) ? v.join(';') : v}), {}),
    queryStringParameters: Object.entries(request.query).reduce((query, [k, v]) => ({...query, [k]: Array.isArray(v) ? v.join(',') : v}), {}),
    pathParameters: { proxy: request.params[0] ?? ''},
    rawPath: request.path,
    body: request.body.toString(request.is('application/json') ? 'utf-8' : 'base64'),
    requestContext: {
      authorizer: {
        jwt: { claims }
      },
      http: {
        method: request.method.toUpperCase(),
        path: request.path
      }
    }
  };
}

/**
 * Send Express Response based on a structured result object of AWS Lambda
 * @param {e.Response} response
 * @param {APIGatewayProxyStructuredResultV2} result
 */
export function sendExpressResponseFromLambdaResult(response: Response, result: APIGatewayProxyStructuredResultV2): void {
  const { statusCode = 200, body, headers = { }, isBase64Encoded } = result;
  response.status(statusCode);
  Object.entries({ contentType: 'application/json', ...headers }).forEach(([key, value]) => {
    typeof value === 'boolean' ? response.header(key) : response.header(key, value.toString());
  })
  body === undefined ? response.send() : response.send(isBase64Encoded ? Buffer.from(body, 'base64') : JSON.parse(body));
}

/**
 * Init Express Server
 * @param {Array<e.Router>} routes
 */
export function createExpressApp(routes: Array<Router>) {
  const app = express();
  app.use(raw({ type: () => true }));
  app.use(routes);
  const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
    console.error(err);
    res.status(500).send('An Internal Error of the Dev Tool Server.');
  }
  app.use(errorHandler);
  return app;
}

/**
 * Init and Run Express Server
 * @param {Array<e.Router>} routes
 * @param {number} port
 */
export function runServer(routes: Array<Router>, port: number) {
  createExpressApp(routes).listen(port, () => {
    console.log(`Listening on http://localhost:${port}`);
  });
}
