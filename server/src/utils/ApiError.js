export class ApiError extends Error {
  constructor(statusCode, message, { code, details, expose } = {}) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code || undefined;
    this.details = details || undefined;
    // 5xx errors are never exposed to clients in production.
    this.expose = expose ?? statusCode < 500;
    Error.captureStackTrace?.(this, ApiError);
  }

  static badRequest(message = 'Invalid request', options) {
    return new ApiError(400, message, { code: 'BAD_REQUEST', ...options });
  }

  static unauthorized(message = 'Authentication required', options) {
    return new ApiError(401, message, { code: 'UNAUTHORIZED', ...options });
  }

  static forbidden(message = 'You do not have access to this resource', options) {
    return new ApiError(403, message, { code: 'FORBIDDEN', ...options });
  }

  static notFound(message = 'Not found', options) {
    return new ApiError(404, message, { code: 'NOT_FOUND', ...options });
  }

  static conflict(message = 'Resource already exists', options) {
    return new ApiError(409, message, { code: 'CONFLICT', ...options });
  }

  static tooMany(message = 'Too many requests, please slow down', options) {
    return new ApiError(429, message, { code: 'RATE_LIMITED', ...options });
  }
}

export default ApiError;
