/**
 * 全局防闪退守护与启动黑匣子日志系统 (CrashGuard & BootLogger)
 */

export interface LogEntry {
  time: string;
  level: 'info' | 'warn' | 'error';
  tag: string;
  message: string;
  stack?: string;
}

const MAX_LOGS = 60;
const logBuffer: LogEntry[] = [];
type LogListener = (entry: LogEntry) => void;
type FatalErrorListener = (error: { message: string; stack?: string }) => void;

const logListeners = new Set<LogListener>();
const fatalErrorListeners = new Set<FatalErrorListener>();

function nowStr(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

export function addBootLog(tag: string, message: string, level: 'info' | 'warn' | 'error' = 'info', stack?: string) {
  const entry: LogEntry = {
    time: nowStr(),
    level,
    tag,
    message,
    stack,
  };
  logBuffer.push(entry);
  if (logBuffer.length > MAX_LOGS) {
    logBuffer.shift();
  }

  if (level === 'error') {
    console.error(`[${entry.time}][${tag}] ${message}`, stack || '');
  } else if (level === 'warn') {
    console.warn(`[${entry.time}][${tag}] ${message}`);
  } else {
    console.log(`[${entry.time}][${tag}] ${message}`);
  }

  logListeners.forEach((fn) => {
    try { fn(entry); } catch (_) {}
  });
}

export function getBootLogs(): LogEntry[] {
  return [...logBuffer];
}

export function subscribeBootLog(listener: LogListener): () => void {
  logListeners.add(listener);
  return () => logListeners.delete(listener);
}

export function subscribeFatalError(listener: FatalErrorListener): () => void {
  fatalErrorListeners.add(listener);
  return () => fatalErrorListeners.delete(listener);
}

// ─── 1. 防御性保护 expo-font 运行时 ─────────────────────────────────────────────
// 保证在任何原生模块异步挂载窗口期或字体未就绪时，Font.isLoaded 与 Font.getLoadedFonts 永不抛出 undefined is not a function
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Font = require('expo-font');
  if (Font) {
    if (typeof Font.isLoaded === 'function') {
      const origIsLoaded = Font.isLoaded;
      Font.isLoaded = function safeIsLoaded(fontFamily: string) {
        try {
          return origIsLoaded(fontFamily);
        } catch (_) {
          return false;
        }
      };
    }
    if (typeof Font.getLoadedFonts === 'function') {
      const origGetLoadedFonts = Font.getLoadedFonts;
      Font.getLoadedFonts = function safeGetLoadedFonts() {
        try {
          return origGetLoadedFonts() || [];
        } catch (_) {
          return [];
        }
      };
    }
    addBootLog('CrashGuard', '已装载 expo-font 运行时安全防护桩');
  }
} catch (_) {}

// ─── 2. 全局 JS 异常拦截器 ───────────────────────────────────────────────────────
(function setupCrashGuard() {
  addBootLog('CrashGuard', '安装全局异常捕获器');

  const g = typeof global !== 'undefined' ? (global as any) : (typeof window !== 'undefined' ? (window as any) : {});
  if (g && g.ErrorUtils) {
    const errorUtils = g.ErrorUtils;
    const originalHandler = typeof errorUtils.getGlobalHandler === 'function' ? errorUtils.getGlobalHandler() : null;

    errorUtils.setGlobalHandler((error: any, isFatal?: boolean) => {
      const msg = error?.message || String(error);
      const stack = error?.stack ? String(error.stack).split('\n').slice(0, 10).join('\n') : undefined;

      addBootLog('FatalError', msg, 'error', stack);

      // 通知全屏 Emergency 错误视图
      fatalErrorListeners.forEach((fn) => {
        try { fn({ message: msg, stack }); } catch (_) {}
      });

      // 强制将 isFatal 设为 false，阻止 Native 层调用 abort() 闪退
      if (typeof originalHandler === 'function') {
        try {
          originalHandler(error, false);
        } catch (_) {}
      }
    });
  }

  if (g && typeof g.addEventListener === 'function') {
    g.addEventListener('unhandledrejection', (event: any) => {
      const reason = event?.reason;
      const msg = reason?.message || String(reason);
      const stack = reason?.stack ? String(reason.stack).split('\n').slice(0, 10).join('\n') : undefined;
      addBootLog('UnhandledPromise', msg, 'error', stack);
      fatalErrorListeners.forEach((fn) => {
        try { fn({ message: msg, stack }); } catch (_) {}
      });
    });
  }
})();
