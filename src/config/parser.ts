import { readFileSync } from 'fs';
import { parse } from 'yaml';
import { ConfigSchema, type Config } from './schema.js';
import { ZodError } from 'zod';

export class ConfigValidationError extends Error {
  constructor(
    message: string,
    public readonly errors: ZodError['errors'],
  ) {
    super(message);
    this.name = 'ConfigValidationError';
  }
}

export class ConfigParser {
  /**
   * Parse and validate a YAML configuration file
   */
  static parseFile(filePath: string): Config {
    try {
      const content = readFileSync(filePath, 'utf8');
      return this.parseString(content, filePath);
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to read config file '${filePath}': ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Parse and validate a YAML configuration string
   */
  static parseString(content: string, filePath = '<string>'): Config {
    try {
      // Parse YAML
      const rawConfig = parse(content);

      if (!rawConfig || typeof rawConfig !== 'object') {
        throw new Error('Configuration must be a valid YAML object');
      }

      // Validate with Zod schema
      const result = ConfigSchema.safeParse(rawConfig);

      if (!result.success) {
        const errorMessage = this.formatValidationErrors(result.error.errors, filePath);
        throw new ConfigValidationError(errorMessage, result.error.errors);
      }

      return result.data;
    } catch (error) {
      if (error instanceof ConfigValidationError) {
        throw error;
      }

      if (error instanceof Error) {
        throw new Error(`Failed to parse config file '${filePath}': ${error.message}`);
      }

      throw error;
    }
  }

  /**
   * Format validation errors for human-readable output
   */
  private static formatValidationErrors(errors: ZodError['errors'], filePath: string): string {
    const formattedErrors = errors.map((error) => {
      const path = error.path.length > 0 ? error.path.join('.') : 'root';
      return `  - ${path}: ${error.message}`;
    });

    return `Configuration validation failed in '${filePath}':\n${formattedErrors.join('\n')}`;
  }

  /**
   * Validate configuration without throwing
   */
  static validate(config: unknown): { valid: true; config: Config } | { valid: false; errors: ZodError['errors'] } {
    const result = ConfigSchema.safeParse(config);

    if (result.success) {
      return { valid: true, config: result.data };
    }

    return { valid: false, errors: result.error.errors };
  }
}
