// ANSI color codes
const COLORS = {
  reset: '\x1b[0m',
  gray: '\x1b[90m',
  dim: '\x1b[2m',
} as const;

export class DebugLogger {
  constructor(private enabled: boolean = false) {}

  log(message: string): void {
    if (this.enabled) {
      console.log(`${COLORS.gray}${message}${COLORS.reset}`);
    }
  }

  group(title: string): void {
    if (this.enabled) {
      console.log(`${COLORS.gray}${title}${COLORS.reset}`);
    }
  }

  item(message: string): void {
    if (this.enabled) {
      console.log(`${COLORS.gray}  - ${message}${COLORS.reset}`);
    }
  }

  subItem(message: string): void {
    if (this.enabled) {
      console.log(`${COLORS.gray}    ${message}${COLORS.reset}`);
    }
  }

  error(message: string): void {
    if (this.enabled) {
      console.log(`${COLORS.gray}❌ ${message}${COLORS.reset}`);
    }
  }

  success(message: string): void {
    if (this.enabled) {
      console.log(`${COLORS.gray}✅ ${message}${COLORS.reset}`);
    }
  }

  warn(message: string): void {
    if (this.enabled) {
      console.log(`${COLORS.gray}⚠️  ${message}${COLORS.reset}`);
    }
  }
}

export function createDebugLoggers(debugOptions: {
  workspace?: boolean;
  traceImports?: boolean;
  bundle?: boolean;
  runtime?: boolean;
}) {
  return {
    workspace: new DebugLogger(debugOptions.workspace),
    traceImports: new DebugLogger(debugOptions.traceImports),
    bundle: new DebugLogger(debugOptions.bundle),
    runtime: new DebugLogger(debugOptions.runtime),
  };
}
