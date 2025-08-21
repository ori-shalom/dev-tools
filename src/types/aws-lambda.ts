// AWS Lambda Context
export type LambdaContext = {
  callbackWaitsForEmptyEventLoop: boolean;
  functionName: string;
  functionVersion: string;
  invokedFunctionArn: string;
  memoryLimitInMB: string;
  awsRequestId: string;
  logGroupName: string;
  logStreamName: string;
  identity?: {
    cognitoIdentityId?: string;
    cognitoIdentityPoolId?: string;
  };
  clientContext?: {
    client: {
      installationId: string;
      appTitle: string;
      appVersionName: string;
      appVersionCode: string;
      appPackageName: string;
    };
    env: {
      platformVersion: string;
      platform: string;
      make: string;
      model: string;
      locale: string;
    };
  };
  getRemainingTimeInMillis(): number;
};

// HTTP Event types
export type ApiGatewayRequestContext = {
  accountId: string;
  apiId: string;
  httpMethod: string;
  requestId: string;
  resourceId: string;
  resourcePath: string;
  stage: string;
  identity: {
    sourceIp: string;
    userAgent: string;
    [key: string]: string | undefined;
  };
  [key: string]: unknown;
};

export type ApiGatewayHttpEvent = {
  httpMethod: string;
  path: string;
  resource: string;
  headers: Record<string, string>;
  multiValueHeaders: Record<string, string[]>;
  queryStringParameters: Record<string, string> | null;
  multiValueQueryStringParameters: Record<string, string[]> | null;
  pathParameters: Record<string, string> | null;
  stageVariables: Record<string, string> | null;
  requestContext: ApiGatewayRequestContext;
  body: string | null;
  isBase64Encoded: boolean;
};

export type ApiGatewayHttpResponse = {
  statusCode: number;
  headers?: Record<string, string>;
  multiValueHeaders?: Record<string, string[]>;
  body: string;
  isBase64Encoded?: boolean;
};

// WebSocket Event types
export type WebSocketRequestContext = {
  routeKey: string;
  messageId?: string;
  eventType: 'CONNECT' | 'MESSAGE' | 'DISCONNECT';
  extendedRequestId: string;
  requestTime: string;
  messageDirection: 'IN';
  stage: string;
  connectedAt: number;
  requestTimeEpoch: number;
  identity: {
    sourceIp: string;
    [key: string]: unknown;
  };
  requestId: string;
  domainName: string;
  connectionId: string;
  apiId: string;
};

export type WebSocketEvent = {
  requestContext: WebSocketRequestContext;
  body?: string;
  isBase64Encoded: boolean;
};

export type WebSocketResponse = {
  statusCode: number;
  headers?: Record<string, string>;
  body?: string;
};

// Handler types
export type HttpHandler = (
  event: ApiGatewayHttpEvent,
  context: LambdaContext,
) => Promise<ApiGatewayHttpResponse> | ApiGatewayHttpResponse;

export type WebSocketHandler = (
  event: WebSocketEvent,
  context: LambdaContext,
) => Promise<WebSocketResponse> | WebSocketResponse | void;

export type LambdaHandler = HttpHandler | WebSocketHandler;
