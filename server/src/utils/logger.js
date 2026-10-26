import config from '../config/env.js';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const minLevel = LEVELS[process.env.LOG_LEVEL] ?? (config.isProd ? LEVELS.info : LEVELS.debug);

function write(level, message, meta) {
  if (LEVELS[level] < minLevel) return;
  const line = {
    time: new Date().toISOString(),
    level,
    message
  };
  if (meta && Object.keys(meta).length) line.meta = meta;
  const serialized = JSON.stringify(line);
  if (level === 'error') console.error(serialized);
  else if (level === 'warn') console.warn(serialized);
  else console.log(serialized);
}

/**
 * Structured logger. Callers must never pass passwords, tokens, cookies or
 * message bodies in `meta` - see the security notes in the README.
 */
export const logger = {
  debug: (message, meta) => write('debug', message, meta),
  info: (message, meta) => write('info', message, meta),
  warn: (message, meta) => write('warn', message, meta),
  error: (message, meta) => write('error', message, meta),
  child(bindings) {
    return {
      debug: (m, meta) => write('debug', m, { ...bindings, ...meta }),
      info: (m, meta) => write('info', m, { ...bindings, ...meta }),
      warn: (m, meta) => write('warn', m, { ...bindings, ...meta }),
      error: (m, meta) => write('error', m, { ...bindings, ...meta })
    };
  }
};

export default logger;
