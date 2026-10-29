import mongoose from 'mongoose';
import config from '../config/env.js';
import ApiError from '../utils/ApiError.js';
import logger from '../utils/logger.js';

export function notFoundHandler(req, res, next) {
  next(ApiError.notFound(`Route ${req.method} ${req.originalUrl} does not exist`, { code: 'ROUTE_NOT_FOUND' }));
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  let error = err;

  if (mongoose.Error?.ValidationError && error instanceof mongoose.Error.ValidationError) {
    const details = {};
    for (const [field, value] of Object.entries(error.errors || {})) details[field] = value.message;
    error = new ApiError(400, 'Please check the highlighted fields', {
      code: 'VALIDATION_ERROR',
      details
    });
  } else if (error?.name === 'CastError') {
    logger.warn('Mongoose CastError', {
      path: error.path,
      kind: error.kind,
      valueType: typeof error.value
    });
    error = new ApiError(400, 'Invalid identifier', { code: 'INVALID_ID' });
  } else if (error?.name === 'UniqueViolationError') {
    // Normalise the in-memory store's uniqueness errors to the same 409 shape
    // the Mongo duplicate-key branch uses. Without this, a race between the
    // pre-check and the write would surface as a generic 500.
    const field = error.field || null;
    const details = {};
    if (field === 'usernameLower' || field === 'username') details.username = 'This username is already taken.';
    else if (field === 'email') details.email = 'An account with this email already exists';
    else if (field === 'pairKey') details._ = 'Conversation already exists';
    else if (field === 'clientId') details._ = 'Duplicate message';
    error = new ApiError(
      409,
      field === 'email'
        ? 'An account with this email already exists'
        : field === 'usernameLower' || field === 'username'
          ? 'This username is already taken.'
          : 'That value is already in use',
      {
        code:
          field === 'usernameLower' || field === 'username'
            ? 'USERNAME_TAKEN'
            : field === 'email'
              ? 'EMAIL_TAKEN'
              : 'DUPLICATE_KEY',
        details: Object.keys(details).length ? details : undefined
      }
    );
  } else if (error?.code === 11000) {
    const rawField = Object.keys(error.keyPattern || error.keyValue || {})[0];
    const field = rawField === 'usernameLower' ? 'username' : rawField;
    const message =
      field === 'username'
        ? 'This username is already taken.'
        : field === 'email'
          ? 'An account with this email already exists'
          : 'That value is already in use';
    error = new ApiError(409, message, {
      code: field === 'username' ? 'USERNAME_TAKEN' : field === 'email' ? 'EMAIL_TAKEN' : 'DUPLICATE_KEY',
      details: field ? { [field]: message } : undefined
    });
  } else if (error?.type === 'entity.too.large') {
    error = new ApiError(413, 'Request payload is too large', { code: 'PAYLOAD_TOO_LARGE' });
  } else if (error?.name === 'MulterError') {
    error = new ApiError(400, error.message, { code: 'UPLOAD_ERROR' });
  }

  const statusCode = error instanceof ApiError ? error.statusCode : error.statusCode || 500;
  const isServerError = statusCode >= 500;

  if (isServerError) {
    logger.error('Unhandled request error', {
      method: req.method,
      path: req.originalUrl,
      error: error.message,
      stack: config.isProd ? undefined : error.stack
    });
  }

  const body = {
    error: {
      message:
        isServerError && config.isProd ? 'Something went wrong on our side. Please try again.' : error.message,
      code: error.code || (isServerError ? 'INTERNAL_ERROR' : 'ERROR')
    }
  };
  if (error.details) body.error.details = error.details;
  if (!config.isProd && isServerError) body.error.stack = error.stack;

  if (res.headersSent) return;
  res.status(statusCode).json(body);
}

export default { errorHandler, notFoundHandler };
