import { LambdaContext } from '../types/aws-lambda.js';

export function createLambdaContext(
  functionName: string,
  requestId: string,
  memorySize = 1024,
  timeout = 30,
): LambdaContext {
  const startTime = Date.now();

  return {
    callbackWaitsForEmptyEventLoop: true,
    functionName,
    functionVersion: '$LATEST',
    invokedFunctionArn: `arn:aws:lambda:local:123456789012:function:${functionName}`,
    memoryLimitInMB: memorySize.toString(),
    awsRequestId: requestId,
    logGroupName: `/aws/lambda/${functionName}`,
    logStreamName: `2023/12/01/[$LATEST]${requestId}`,

    getRemainingTimeInMillis(): number {
      const elapsed = Date.now() - startTime;
      const remaining = timeout * 1000 - elapsed;
      return Math.max(0, remaining);
    },
  };
}
