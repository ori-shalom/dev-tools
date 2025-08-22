import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createLambdaContext } from './lambda-context.js';

describe('createLambdaContext', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should create basic lambda context with required fields', () => {
    const functionName = 'test-function';
    const requestId = 'abc123def456';

    const context = createLambdaContext(functionName, requestId);

    expect(context.functionName).toBe('test-function');
    expect(context.awsRequestId).toBe('abc123def456');
    expect(context.functionVersion).toBe('$LATEST');
    expect(context.invokedFunctionArn).toBe('arn:aws:lambda:local:123456789012:function:test-function');
    expect(context.logGroupName).toBe('/aws/lambda/test-function');
    expect(context.logStreamName).toBe('2023/12/01/[$LATEST]abc123def456');
    expect(context.callbackWaitsForEmptyEventLoop).toBe(true);
  });

  it('should use default memory size and timeout', () => {
    const context = createLambdaContext('test', 'request123');

    expect(context.memoryLimitInMB).toBe('1024');
    // Default timeout is 30 seconds = 30000ms
    expect(context.getRemainingTimeInMillis()).toBe(30000);
  });

  it('should use custom memory size', () => {
    const context = createLambdaContext('test', 'request123', 2048);

    expect(context.memoryLimitInMB).toBe('2048');
  });

  it('should use custom timeout', () => {
    const context = createLambdaContext('test', 'request123', 1024, 60);

    // Custom timeout is 60 seconds = 60000ms
    expect(context.getRemainingTimeInMillis()).toBe(60000);
  });

  it('should use custom memory size and timeout', () => {
    const context = createLambdaContext('test', 'request123', 512, 15);

    expect(context.memoryLimitInMB).toBe('512');
    expect(context.getRemainingTimeInMillis()).toBe(15000);
  });

  describe('getRemainingTimeInMillis', () => {
    it('should return full timeout at start', () => {
      const context = createLambdaContext('test', 'request123', 1024, 30);

      expect(context.getRemainingTimeInMillis()).toBe(30000);
    });

    it('should decrease remaining time as time passes', () => {
      const context = createLambdaContext('test', 'request123', 1024, 30);

      // Advance time by 5 seconds
      vi.advanceTimersByTime(5000);

      expect(context.getRemainingTimeInMillis()).toBe(25000);
    });

    it('should return 0 when timeout is exceeded', () => {
      const context = createLambdaContext('test', 'request123', 1024, 10);

      // Advance time by more than timeout (15 seconds > 10 seconds)
      vi.advanceTimersByTime(15000);

      expect(context.getRemainingTimeInMillis()).toBe(0);
    });

    it('should never return negative values', () => {
      const context = createLambdaContext('test', 'request123', 1024, 5);

      // Advance time by much more than timeout
      vi.advanceTimersByTime(60000);

      expect(context.getRemainingTimeInMillis()).toBe(0);
    });

    it('should work with very short timeouts', () => {
      const context = createLambdaContext('test', 'request123', 1024, 1);

      expect(context.getRemainingTimeInMillis()).toBe(1000);

      vi.advanceTimersByTime(500);
      expect(context.getRemainingTimeInMillis()).toBe(500);

      vi.advanceTimersByTime(600);
      expect(context.getRemainingTimeInMillis()).toBe(0);
    });

    it('should work with very long timeouts', () => {
      const context = createLambdaContext('test', 'request123', 1024, 900); // 15 minutes

      expect(context.getRemainingTimeInMillis()).toBe(900000);

      vi.advanceTimersByTime(300000); // 5 minutes
      expect(context.getRemainingTimeInMillis()).toBe(600000); // 10 minutes left
    });

    it('should handle multiple calls correctly', () => {
      const context = createLambdaContext('test', 'request123', 1024, 20);

      expect(context.getRemainingTimeInMillis()).toBe(20000);

      vi.advanceTimersByTime(3000);
      expect(context.getRemainingTimeInMillis()).toBe(17000);

      vi.advanceTimersByTime(7000);
      expect(context.getRemainingTimeInMillis()).toBe(10000);

      vi.advanceTimersByTime(5000);
      expect(context.getRemainingTimeInMillis()).toBe(5000);

      vi.advanceTimersByTime(10000); // Exceed timeout
      expect(context.getRemainingTimeInMillis()).toBe(0);
    });
  });

  describe('context fields formatting', () => {
    it('should format ARN correctly with function name', () => {
      const context = createLambdaContext('my-api-function', 'req123');

      expect(context.invokedFunctionArn).toBe('arn:aws:lambda:local:123456789012:function:my-api-function');
    });

    it('should format log group name correctly', () => {
      const context = createLambdaContext('background-job', 'req456');

      expect(context.logGroupName).toBe('/aws/lambda/background-job');
    });

    it('should format log stream name correctly', () => {
      const context = createLambdaContext('processor', 'req789xyz');

      expect(context.logStreamName).toBe('2023/12/01/[$LATEST]req789xyz');
    });

    it('should handle function names with special characters', () => {
      const context = createLambdaContext('my-function_v2', 'req123');

      expect(context.invokedFunctionArn).toBe('arn:aws:lambda:local:123456789012:function:my-function_v2');
      expect(context.logGroupName).toBe('/aws/lambda/my-function_v2');
    });

    it('should convert memory size to string', () => {
      const context1 = createLambdaContext('test', 'req1', 128);
      const context2 = createLambdaContext('test', 'req2', 10240);

      expect(context1.memoryLimitInMB).toBe('128');
      expect(context2.memoryLimitInMB).toBe('10240');
      expect(typeof context1.memoryLimitInMB).toBe('string');
      expect(typeof context2.memoryLimitInMB).toBe('string');
    });
  });

  describe('edge cases', () => {
    it('should handle empty function name', () => {
      const context = createLambdaContext('', 'req123');

      expect(context.functionName).toBe('');
      expect(context.invokedFunctionArn).toBe('arn:aws:lambda:local:123456789012:function:');
      expect(context.logGroupName).toBe('/aws/lambda/');
    });

    it('should handle empty request ID', () => {
      const context = createLambdaContext('test', '');

      expect(context.awsRequestId).toBe('');
      expect(context.logStreamName).toBe('2023/12/01/[$LATEST]');
    });

    it('should handle zero timeout', () => {
      const context = createLambdaContext('test', 'req123', 1024, 0);

      expect(context.getRemainingTimeInMillis()).toBe(0);

      vi.advanceTimersByTime(1000);
      expect(context.getRemainingTimeInMillis()).toBe(0);
    });

    it('should handle zero memory size', () => {
      const context = createLambdaContext('test', 'req123', 0);

      expect(context.memoryLimitInMB).toBe('0');
    });

    it('should handle very large memory size', () => {
      const context = createLambdaContext('test', 'req123', 999999);

      expect(context.memoryLimitInMB).toBe('999999');
    });

    it('should handle fractional timeout correctly', () => {
      // Even though timeout is typically an integer, test fractional values
      const context = createLambdaContext('test', 'req123', 1024, 10.5);

      expect(context.getRemainingTimeInMillis()).toBe(10500);

      vi.advanceTimersByTime(5250);
      expect(context.getRemainingTimeInMillis()).toBe(5250);
    });
  });

  describe('context immutability', () => {
    it('should maintain consistent values across multiple calls', () => {
      const context = createLambdaContext('consistent-test', 'req123', 2048, 45);

      expect(context.functionName).toBe('consistent-test');
      expect(context.awsRequestId).toBe('req123');
      expect(context.memoryLimitInMB).toBe('2048');

      // These should remain the same regardless of how many times we access them
      for (let i = 0; i < 10; i++) {
        expect(context.functionName).toBe('consistent-test');
        expect(context.awsRequestId).toBe('req123');
        expect(context.functionVersion).toBe('$LATEST');
      }
    });

    it('should not affect other context instances', () => {
      const context1 = createLambdaContext('func1', 'req1', 512, 10);
      const context2 = createLambdaContext('func2', 'req2', 1024, 20);

      vi.advanceTimersByTime(5000);

      expect(context1.getRemainingTimeInMillis()).toBe(5000);
      expect(context2.getRemainingTimeInMillis()).toBe(15000);

      expect(context1.functionName).toBe('func1');
      expect(context2.functionName).toBe('func2');
      expect(context1.memoryLimitInMB).toBe('512');
      expect(context2.memoryLimitInMB).toBe('1024');
    });
  });
});
