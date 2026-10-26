/**
 * Express 4 does not forward rejected promises from async handlers to the error
 * middleware, which leaves the request hanging and can crash the process on an
 * unhandled rejection. Every async controller goes through this wrapper so that
 * failures always reach `errorHandler` and produce a JSON response.
 */
export function asyncHandler(fn) {
  if (typeof fn !== 'function') throw new TypeError('asyncHandler expects a function');
  return function wrapped(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/** Wraps every exported async function of a controller module. */
export function wrapAll(controller) {
  const wrapped = {};
  for (const [key, value] of Object.entries(controller)) {
    wrapped[key] = typeof value === 'function' ? asyncHandler(value) : value;
  }
  return wrapped;
}

export default asyncHandler;
