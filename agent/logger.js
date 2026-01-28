import winston from 'winston';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Define log format
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.printf(({ timestamp, level, message, stack }) => {
    return stack
      ? `${timestamp} [${level.toUpperCase()}]: ${message}\n${stack}`
      : `${timestamp} [${level.toUpperCase()}]: ${message}`;
  }),
);

// Create logger instance
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: logFormat,
  transports: [
    // Console output
    new winston.transports.Console({
      format: winston.format.combine(winston.format.colorize(), logFormat),
    }),
    // File output - errors only
    new winston.transports.File({
      filename: path.join(__dirname, 'logs/error.log'),
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
    // File output - all logs
    new winston.transports.File({
      filename: path.join(__dirname, 'logs/combined.log'),
      maxsize: 5242880, // 5MB
      maxFiles: 10,
    }),
  ],
});

// Create context-specific loggers
export function createContextLogger(context) {
  return {
    info: (message, ...args) => logger.info(`[${context}] ${message}`, ...args),
    warn: (message, ...args) => logger.warn(`[${context}] ${message}`, ...args),
    error: (message, ...args) =>
      logger.error(`[${context}] ${message}`, ...args),
    debug: (message, ...args) =>
      logger.debug(`[${context}] ${message}`, ...args),
  };
}

export default logger;
