/**
 * Configuration Diagnostic Logging
 *
 * Provides comprehensive logging for configuration operations:
 * - Configuration sources tracking
 * - Operation audit trail
 * - Troubleshooting insights
 * - Performance metrics
 *
 * @module lib/config-logger
 */

import { existsSync, mkdirSync, appendFileSync } from "fs";
import { resolve } from "path";
import { homedir } from "os";

/**
 * Log level enumeration
 */
export enum LogLevel {
    DEBUG = "DEBUG",
    INFO = "INFO",
    WARN = "WARN",
    ERROR = "ERROR",
}

/**
 * Log entry structure
 */
export interface LogEntry {
    timestamp: string;
    level: LogLevel;
    operation: string;
    message: string;
    data?: Record<string, unknown>;
    source?: string;
    profileName?: string;
    duration?: number;
}

/**
 * Configuration operation types
 */
export enum ConfigOperation {
    READ = "read",
    WRITE = "write",
    VALIDATE = "validate",
    MERGE = "merge",
    SYNC_SECRETS = "sync-secrets",
    INFER_CONFIG = "infer-config",
    CREATE_PROFILE = "create-profile",
    DELETE_PROFILE = "delete-profile",
}

/**
 * Configuration logger for diagnostic and audit purposes
 */
export class ConfigLogger {
    private logFile: string;
    private enableConsole: boolean;
    private minLogLevel: LogLevel;

    /**
     * Creates a new configuration logger
     *
     * @param options - Logger configuration options
     */
    constructor(options?: {
        logFile?: string;
        enableConsole?: boolean;
        minLogLevel?: LogLevel;
    }) {
        const { logFile, enableConsole = true, minLogLevel = LogLevel.INFO } = options || {};

        // Default log file location
        const logDir = resolve(homedir(), ".config", "benchling-webhook", "logs");
        if (!existsSync(logDir)) {
            mkdirSync(logDir, { recursive: true });
        }

        this.logFile = logFile || resolve(logDir, "config.log");
        this.enableConsole = enableConsole;
        this.minLogLevel = minLogLevel;
    }

    /**
     * Gets log level priority for comparison
     *
     * @param level - Log level
     * @returns Priority number (higher = more severe)
     */
    private getLogLevelPriority(level: LogLevel): number {
        switch (level) {
        case LogLevel.DEBUG:
            return 0;
        case LogLevel.INFO:
            return 1;
        case LogLevel.WARN:
            return 2;
        case LogLevel.ERROR:
            return 3;
        default:
            return 1;
        }
    }

    /**
     * Checks if log level should be output
     *
     * @param level - Log level to check
     * @returns True if should log
     */
    private shouldLog(level: LogLevel): boolean {
        return this.getLogLevelPriority(level) >= this.getLogLevelPriority(this.minLogLevel);
    }

    /**
     * Formats log entry for output
     *
     * @param entry - Log entry
     * @returns Formatted log string
     */
    private formatLogEntry(entry: LogEntry): string {
        const parts = [
            entry.timestamp,
            `[${entry.level}]`,
            `[${entry.operation}]`,
            entry.message,
        ];

        if (entry.source) {
            parts.push(`source=${entry.source}`);
        }

        if (entry.profileName) {
            parts.push(`profile=${entry.profileName}`);
        }

        if (entry.duration !== undefined) {
            parts.push(`duration=${entry.duration}ms`);
        }

        if (entry.data) {
            parts.push(`data=${JSON.stringify(entry.data)}`);
        }

        return parts.join(" ");
    }

    /**
     * Writes log entry to file and console
     *
     * @param entry - Log entry to write
     */
    private writeLog(entry: LogEntry): void {
        if (!this.shouldLog(entry.level)) {
            return;
        }

        const formattedLog = this.formatLogEntry(entry);

        // Write to file
        try {
            appendFileSync(this.logFile, formattedLog + "\n", "utf-8");
        } catch (error) {
            console.error(`Failed to write log: ${(error as Error).message}`);
        }

        // Write to console
        if (this.enableConsole) {
            switch (entry.level) {
            case LogLevel.DEBUG:
                console.debug(formattedLog);
                break;
            case LogLevel.INFO:
                console.log(formattedLog);
                break;
            case LogLevel.WARN:
                console.warn(formattedLog);
                break;
            case LogLevel.ERROR:
                console.error(formattedLog);
                break;
            }
        }
    }

    /**
     * Logs a debug message
     *
     * @param operation - Configuration operation
     * @param message - Log message
     * @param data - Additional data
     */
    public debug(operation: ConfigOperation | string, message: string, data?: Record<string, unknown>): void {
        this.writeLog({
            timestamp: new Date().toISOString(),
            level: LogLevel.DEBUG,
            operation,
            message,
            data,
        });
    }

    /**
     * Logs an info message
     *
     * @param operation - Configuration operation
     * @param message - Log message
     * @param data - Additional data
     */
    public info(operation: ConfigOperation | string, message: string, data?: Record<string, unknown>): void {
        this.writeLog({
            timestamp: new Date().toISOString(),
            level: LogLevel.INFO,
            operation,
            message,
            data,
        });
    }

    /**
     * Logs a warning message
     *
     * @param operation - Configuration operation
     * @param message - Log message
     * @param data - Additional data
     */
    public warn(operation: ConfigOperation | string, message: string, data?: Record<string, unknown>): void {
        this.writeLog({
            timestamp: new Date().toISOString(),
            level: LogLevel.WARN,
            operation,
            message,
            data,
        });
    }

    /**
     * Logs an error message
     *
     * @param operation - Configuration operation
     * @param message - Log message
     * @param data - Additional data
     */
    public error(operation: ConfigOperation | string, message: string, data?: Record<string, unknown>): void {
        this.writeLog({
            timestamp: new Date().toISOString(),
            level: LogLevel.ERROR,
            operation,
            message,
            data,
        });
    }

    /**
     * Logs configuration operation with timing
     *
     * @param operation - Configuration operation
     * @param profileName - Profile name
     * @param source - Configuration source
     * @param fn - Function to execute and time
     * @returns Result of the function
     */
    public async logOperation<T>(
        operation: ConfigOperation,
        profileName: string,
        source: string,
        fn: () => Promise<T> | T,
    ): Promise<T> {
        const startTime = Date.now();

        this.info(operation, "Starting operation", {
            profileName,
            source,
        });

        try {
            const result = await fn();
            const duration = Date.now() - startTime;

            this.info(operation, "Operation completed successfully", {
                profileName,
                source,
                duration,
            });

            return result;
        } catch (error) {
            const duration = Date.now() - startTime;

            this.error(operation, `Operation failed: ${(error as Error).message}`, {
                profileName,
                source,
                duration,
                error: (error as Error).stack,
            });

            throw error;
        }
    }

    /**
     * Logs configuration read operation
     *
     * @param profileName - Profile name
     * @param configType - Configuration type
     * @param success - Whether read was successful
     * @param source - Configuration source
     */
    public logRead(profileName: string, configType: string, success: boolean, source?: string): void {
        const entry: LogEntry = {
            timestamp: new Date().toISOString(),
            level: success ? LogLevel.INFO : LogLevel.ERROR,
            operation: ConfigOperation.READ,
            message: `Configuration read ${success ? "successful" : "failed"}`,
            profileName,
            source,
            data: {
                configType,
            },
        };

        this.writeLog(entry);
    }

    /**
     * Logs configuration write operation
     *
     * @param profileName - Profile name
     * @param configType - Configuration type
     * @param success - Whether write was successful
     * @param source - Configuration source
     */
    public logWrite(profileName: string, configType: string, success: boolean, source?: string): void {
        const entry: LogEntry = {
            timestamp: new Date().toISOString(),
            level: success ? LogLevel.INFO : LogLevel.ERROR,
            operation: ConfigOperation.WRITE,
            message: `Configuration write ${success ? "successful" : "failed"}`,
            profileName,
            source,
            data: {
                configType,
            },
        };

        this.writeLog(entry);
    }

    /**
     * Logs configuration validation
     *
     * @param profileName - Profile name
     * @param isValid - Whether configuration is valid
     * @param errors - Validation errors
     */
    public logValidation(profileName: string, isValid: boolean, errors?: string[]): void {
        const entry: LogEntry = {
            timestamp: new Date().toISOString(),
            level: isValid ? LogLevel.INFO : LogLevel.WARN,
            operation: ConfigOperation.VALIDATE,
            message: `Configuration validation ${isValid ? "passed" : "failed"}`,
            profileName,
            data: errors ? { errors } : undefined,
        };

        this.writeLog(entry);
    }

    /**
     * Logs secrets sync operation
     *
     * @param profileName - Profile name
     * @param secretArn - Secret ARN
     * @param action - Action performed (created/updated/skipped)
     */
    public logSecretsSync(profileName: string, secretArn: string, action: string): void {
        const entry: LogEntry = {
            timestamp: new Date().toISOString(),
            level: LogLevel.INFO,
            operation: ConfigOperation.SYNC_SECRETS,
            message: `Secrets ${action}`,
            profileName,
            data: {
                secretArn,
                action,
            },
        };

        this.writeLog(entry);
    }

    /**
     * Gets the log file path
     *
     * @returns Log file path
     */
    public getLogFile(): string {
        return this.logFile;
    }
}

/**
 * Global configuration logger instance
 */
let globalLogger: ConfigLogger | null = null;

/**
 * Gets or creates the global configuration logger
 *
 * @param options - Logger options (only used on first call)
 * @returns Configuration logger instance
 */
export function getConfigLogger(options?: {
    logFile?: string;
    enableConsole?: boolean;
    minLogLevel?: LogLevel;
}): ConfigLogger {
    if (!globalLogger) {
        globalLogger = new ConfigLogger(options);
    }
    return globalLogger;
}

/**
 * Sets the global configuration logger
 *
 * @param logger - Logger instance
 */
export function setConfigLogger(logger: ConfigLogger): void {
    globalLogger = logger;
}
