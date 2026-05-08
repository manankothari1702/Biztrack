import { Component, type ErrorInfo, type ReactNode } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faExclamationTriangle, faRotate, faHome, faHeadset } from "@fortawesome/free-solid-svg-icons";
import { logger } from "../../utils/logger";

interface Props {
    children?: ReactNode;
    fallback?: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
    errorInfo: ErrorInfo | null;
}

/**
 * Error Reporting Service
 * Captures and reports errors to external services in production
 */
class ErrorReportingService {
    private static instance: ErrorReportingService;
    private isInitialized = false;
    private isDevelopment = import.meta.env.DEV;

    private constructor() {
        this.initialize();
    }

    public static getInstance(): ErrorReportingService {
        if (!ErrorReportingService.instance) {
            ErrorReportingService.instance = new ErrorReportingService();
        }
        return ErrorReportingService.instance;
    }

    private initialize(): void {
        // Initialize error reporting service
        // In production, this would connect to Sentry, LogRocket, or similar
        const reportingDsn = import.meta.env.VITE_ERROR_REPORTING_DSN;

        if (reportingDsn && !this.isDevelopment) {
            // Production error reporting initialization
            // Example: Sentry.init({ dsn: reportingDsn });
            this.isInitialized = true;
            logger.info('[ErrorReporting] Production error reporting initialized');
        } else if (this.isDevelopment) {
            logger.info('[ErrorReporting] Development mode - errors logged to console only');
        }
    }

    public captureError(
        error: Error,
        errorInfo: ErrorInfo,
        additionalContext?: Record<string, unknown>
    ): void {
        const errorReport = {
            timestamp: new Date().toISOString(),
            environment: this.isDevelopment ? 'development' : 'production',
            error: {
                name: error.name,
                message: error.message,
                stack: error.stack,
            },
            componentStack: errorInfo.componentStack,
            userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'Unknown',
            url: typeof window !== 'undefined' ? window.location.href : 'Unknown',
            ...additionalContext,
        };

        if (this.isDevelopment) {
            // In development, log detailed error to console
            console.group('🔴 React Error Boundary Caught an Error');
            logger.error('Error:', error);
            logger.error('Component Stack:', errorInfo.componentStack);
            console.table(errorReport);
            console.groupEnd();
        } else if (this.isInitialized) {
            // In production, send to error reporting service
            // Example: Sentry.captureException(error, { extra: errorReport });
            this.sendToReportingService(errorReport);
        } else {
            // Fallback: log to console in production if no service configured
            logger.error('[ErrorReporting] Uncaught error:', errorReport);
        }
    }

    private sendToReportingService(errorReport: Record<string, unknown>): void {
        // This is where you would send to your error reporting service
        // Example implementations:

        // Sentry:
        // Sentry.captureException(new Error(errorReport.error.message), {
        //     extra: errorReport
        // });

        // Custom endpoint:
        const reportingEndpoint = import.meta.env.VITE_ERROR_REPORTING_ENDPOINT;
        if (reportingEndpoint) {
            fetch(reportingEndpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(errorReport),
            }).catch((err) => {
                logger.error('[ErrorReporting] Failed to send error report:', err);
            });
        }
    }
}

/**
 * Global Error Boundary Component
 *
 * Catches JavaScript errors anywhere in the child component tree,
 * logs them, and displays a user-friendly fallback UI.
 *
 * Usage: Wrap at the root of your application (App.tsx)
 *
 * @example
 * <ErrorBoundary>
 *   <App />
 * </ErrorBoundary>
 */
class ErrorBoundary extends Component<Props, State> {
    private errorReporter = ErrorReportingService.getInstance();

    public state: State = {
        hasError: false,
        error: null,
        errorInfo: null,
    };

    public static getDerivedStateFromError(error: Error): Partial<State> {
        // Update state so the next render will show the fallback UI
        return { hasError: true, error };
    }

    public componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
        // Update state with error info for potential display
        this.setState({ errorInfo });

        // Report error to monitoring service
        this.errorReporter.captureError(error, errorInfo, {
            timestamp: Date.now(),
            sessionId: this.getSessionId(),
        });
    }

    private getSessionId(): string {
        // Generate or retrieve a session ID for error tracking
        let sessionId = sessionStorage.getItem('errorSessionId');
        if (!sessionId) {
            sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            sessionStorage.setItem('errorSessionId', sessionId);
        }
        return sessionId;
    }

    private handleReload = (): void => {
        window.location.reload();
    };

    private handleGoHome = (): void => {
        // Clear error state and navigate to home
        this.setState({ hasError: false, error: null, errorInfo: null });
        window.location.href = '/';
    };

    private handleRetry = (): void => {
        // Clear error state to allow re-render attempt
        this.setState({ hasError: false, error: null, errorInfo: null });
    };

    public render(): ReactNode {
        if (this.state.hasError) {
            // Allow custom fallback UI
            if (this.props.fallback) {
                return this.props.fallback;
            }

            // Default user-friendly fallback UI
            return (
                <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 p-4">
                    <div className="w-full max-w-lg">
                        {/* Error Icon */}
                        <div className="mb-6 flex justify-center">
                            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-red-100">
                                <FontAwesomeIcon
                                    icon={faExclamationTriangle}
                                    className="h-10 w-10 text-red-500"
                                />
                            </div>
                        </div>

                        {/* Error Card */}
                        <div className="rounded-2xl bg-white p-8 shadow-xl ring-1 ring-slate-200">
                            <h1 className="mb-2 text-center text-2xl font-bold text-slate-800">
                                Oops! Something went wrong
                            </h1>
                            <p className="mb-6 text-center text-slate-600">
                                We encountered an unexpected error. Don't worry, our team has been notified
                                and is working to fix it.
                            </p>

                            {/* Recovery Actions */}
                            <div className="space-y-3">
                                <button
                                    onClick={this.handleRetry}
                                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 font-semibold text-white transition-all hover:bg-blue-700 hover:shadow-lg active:scale-[0.98]"
                                >
                                    <FontAwesomeIcon icon={faRotate} className="h-4 w-4" />
                                    Try Again
                                </button>

                                <button
                                    onClick={this.handleGoHome}
                                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-100 px-4 py-3 font-semibold text-slate-700 transition-all hover:bg-slate-200 active:scale-[0.98]"
                                >
                                    <FontAwesomeIcon icon={faHome} className="h-4 w-4" />
                                    Go to Dashboard
                                </button>

                                <button
                                    onClick={this.handleReload}
                                    className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 font-medium text-slate-600 transition-all hover:bg-slate-50 active:scale-[0.98]"
                                >
                                    Reload Application
                                </button>
                            </div>

                            {/* Support Link */}
                            <div className="mt-6 border-t border-slate-100 pt-4">
                                <p className="text-center text-sm text-slate-500">
                                    If the problem persists, please{' '}
                                    <button
                                        onClick={() => window.open('mailto:support@biztrack.com?subject=Application Error Report', '_blank')}
                                        className="inline-flex items-center gap-1 font-medium text-blue-600 hover:text-blue-700 hover:underline"
                                    >
                                        <FontAwesomeIcon icon={faHeadset} className="h-3 w-3" />
                                        contact support
                                    </button>
                                </p>
                            </div>
                        </div>

                        {/* Error ID for support reference (no sensitive data shown) */}
                        <p className="mt-4 text-center text-xs text-slate-400">
                            Error ID: {this.getSessionId().slice(-8).toUpperCase()}
                        </p>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;