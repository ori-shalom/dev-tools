import { describe, it, expect } from 'vitest';

describe('Main exports', () => {
  it('should export types from aws-lambda module', async () => {
    const exports = await import('./index.js');

    // Verify the module can be imported without errors
    expect(exports).toBeDefined();
  });

  it('should export config types', async () => {
    // Import types to verify they exist
    const { ConfigSchema } = await import('./config/schema.js');

    expect(ConfigSchema).toBeDefined();
    expect(typeof ConfigSchema.parse).toBe('function');
  });

  it('should export AWS Lambda types', async () => {
    // Import types to verify they exist
    const awsTypes = await import('./types/aws-lambda.js');

    expect(awsTypes).toBeDefined();
  });
});
