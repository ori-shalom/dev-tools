/**
 * Custom route matching for AWS API Gateway path templates
 * Converts templates like /api/{proxy+} directly to regex patterns
 * without intermediate conversion steps
 */

import { HttpEvent, LambdaFunction } from '../config/schema.js';

export type RouteMatch = {
  pathParameters: Record<string, string>;
};

export type Route = {
  pattern: string;
  method: string;
  regex: RegExp;
  paramNames: string[];
  functionName: string;
  functionConfig: LambdaFunction;
  event: HttpEvent;
};

export class RouteMatcher {
  private routes: Route[] = [];

  /**
   * Escape regex special characters in path segments
   */
  private escapeRegexChars(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Parse AWS API Gateway path template directly to regex with named capture groups
   * Examples:
   * - /api/{proxy+} -> /^\/api\/(?<proxy>.*)$/
   * - /users/{id} -> /^\/users\/(?<id>[^/]+)$/
   * - /v1/{id}/items/{proxy+} -> /^\/v1\/(?<id>[^/]+)\/items\/(?<proxy>.*)$/
   */
  private parsePathTemplate(template: string): { regex: RegExp; paramNames: string[] } {
    const paramNames: string[] = [];

    // Split path into segments and process each one
    const segments = template.split('/').map((segment) => {
      if (!segment) return ''; // Handle leading/trailing slashes

      // Check if this segment contains parameters
      if (segment.includes('{')) {
        if (!segment.includes('}')) {
          throw new Error(`Invalid parameter syntax in path: ${segment}`);
        }
        const paramMatch = segment.match(/\{([^}]+)\}/);
        if (!paramMatch) {
          throw new Error(`Invalid parameter syntax in path: ${segment}`);
        }

        const paramName = paramMatch[1];

        // Handle proxy+ parameters (catch-all)
        if (paramName.endsWith('+')) {
          const actualParamName = paramName.slice(0, -1);
          paramNames.push(actualParamName);
          return `(?<${actualParamName}>.*)`; // Named group matching everything
        } else {
          paramNames.push(paramName);
          return `(?<${paramName}>[^/]+)`; // Named group matching segment
        }
      } else {
        // Regular path segment - escape regex chars
        return this.escapeRegexChars(segment);
      }
    });

    // Join segments back with slashes and create regex
    const regexPattern = '^/' + segments.filter((s) => s !== '').join('/') + '$';
    const regex = new RegExp(regexPattern);

    return { regex, paramNames };
  }

  /**
   * Register a route with the matcher
   */
  registerRoute(
    pattern: string,
    method: string,
    functionName: string,
    functionConfig: LambdaFunction,
    event: HttpEvent,
  ): void {
    const { regex, paramNames } = this.parsePathTemplate(pattern);

    this.routes.push({
      pattern,
      method: method.toUpperCase(),
      regex,
      paramNames,
      functionName,
      functionConfig,
      event,
    });
  }

  /**
   * Find matching route for a request
   */
  matchRoute(path: string, method: string): { route: Route; match: RouteMatch } | null {
    const upperMethod = method.toUpperCase();

    for (const route of this.routes) {
      // Check if method matches (or route accepts ANY)
      if (route.method !== 'ANY' && route.method !== upperMethod) {
        continue;
      }

      // Test path against regex
      const match = path.match(route.regex);
      if (!match) {
        continue;
      }

      // Extract path parameters from named groups and URL decode them
      // AWS API Gateway automatically URL decodes path parameters
      const pathParameters: Record<string, string> = {};
      if (match.groups) {
        Object.entries(match.groups).forEach(([key, value]) => {
          if (value !== undefined) {
            pathParameters[key] = decodeURIComponent(value);
          }
        });
      }

      return {
        route,
        match: { pathParameters },
      };
    }

    return null;
  }

  /**
   * Get all registered routes (for debugging)
   */
  getRoutes(): Route[] {
    return [...this.routes];
  }
}
