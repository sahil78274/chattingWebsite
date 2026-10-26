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
    error = new ApiError(400, 'Invalid identifier', { code: 'INVALID_ID' });
  } else if (error?.code === 11000) {
    const field = Object.keys(error.keyPattern || error.keyValue || {})[0];
    error = new ApiError(409, 'That value is already in use', {
      code: 'DUPLICATE_KEY',
      details: field ? { [field]: 'Already in use' } : undefined
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
