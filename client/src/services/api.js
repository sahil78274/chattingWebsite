/**
 * Thin fetch wrapper for the Connectly API.
 *
 * Auth model: the long-lived refresh token lives in an httpOnly cookie set by
 * the API, so it is never readable from JavaScript. The short-lived access token
 * is kept in memory only. On boot (and after a reload) the app calls
 * /auth/refresh to exchange the cookie for a fresh access token.
 */
const rawBase = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');
export const API_BASE = rawBase ? `${rawBase}/api` : '/api';
export const API_ORIGIN = rawBase || '';
export const SOCKET_URL =
  (import.meta.env.VITE_SOCKET_URL || rawBase || '').replace(/\/+$/, '') ||
  (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:4000');

let accessToken = null;
let refreshPromise = null;

export function setAccessToken(token) {
  accessToken = token || null;
}

export function getAccessToken() {
  return accessToken;
}

export function resolveAssetUrl(url) {
  if (!url) return '';
  if (/^(https?:|data:|blob:)/i.test(url)) return url;
  return `${API_ORIGIN}${url}`;
}

export class ApiError extends Error {
  constructor(message, { status = 0, code = 'ERROR', details = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const SESSION_EXPIRED_EVENT = 'connectly:session-expired';

export function notifySessionExpired() {
  setAccessToken(null);
  window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
}

export function onSessionExpired(handler) {
  window.addEventListener(SESSION_EXPIRED_EVENT, handler);
  return () => window.removeEventListener(SESSION_EXPIRED_EVENT, handler);
}

async function parseResponse(response) {
  if (response.status === 204) return null;
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) return null;
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function buildError(response, payload) {
  const error = payload?.error || {};
  return new ApiError(error.message || `Request failed (${response.status})`, {
    status: response.status,
    code: error.code || 'ERROR',
    details: error.details || null
  });
}

/** Refreshes the access token once, sharing a single in-flight request. */
export function refreshAccessToken() {
  if (!refreshPromise) {
    refreshPromise = fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    })
      .then(async (response) => {
        if (!response.ok) return null;
        const data = await parseResponse(response);
        if (data?.accessToken) setAccessToken(data.accessToken);
        return data;
      })
      .catch(() => null)
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

export async function apiRequest(path, options = {}) {
  const {
    method = 'GET',
    body,
    auth = true,
    raw = false,
    headers: extraHeaders = {},
    _retried = false
  } = options;

  const headers = { ...extraHeaders };
  let payload;

  if (body instanceof FormData) {
    payload = body;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  if (auth && accessToken) headers.Authorization = `Bearer ${accessToken}`;

  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: payload,
      credentials: 'include'
    });
  } catch {
    throw new ApiError('Cannot reach the server. Check your connection and try again.', {
      code: 'NETWORK_ERROR'
    });
  }

  if (response.status === 401 && auth) {
    if (!_retried) {
      const refreshed = await refreshAccessToken();
      if (refreshed?.accessToken) {
        return apiRequest(path, { ...options, _retried: true });
      }
      // Fall back to the non-httpOnly access cookie (same-site deployments).
      const cookieToken = document.cookie
        .split(';')
        .map((part) => part.trim())
        .find((part) => part.startsWith('connectly_at='));
      if (cookieToken) {
        setAccessToken(decodeURIComponent(cookieToken.slice('connectly_at='.length)));
        return apiRequest(path, { ...options, _retried: true });
      }
    }
    // Either the refresh failed or the retried request was rejected again:
    // end the session so the UI returns to the sign-in screen.
    notifySessionExpired();
  }

  const data = raw ? response : await parseResponse(response);

  if (!response.ok) throw buildError(response, data);
  return data;
}

export const api = {
  // authentication
  register: (payload) => apiRequest('/auth/register', { method: 'POST', body: payload, auth: false }),
  login: (payload) => apiRequest('/auth/login', { method: 'POST', body: payload, auth: false }),
  logout: () => apiRequest('/auth/logout', { method: 'POST', auth: false }),
  me: () => apiRequest('/auth/me'),
  updateProfile: (payload) => apiRequest('/auth/me', { method: 'PATCH', body: payload }),
  uploadAvatar: (file) => {
    const form = new FormData();
    form.append('avatar', file);
    return apiRequest('/auth/me/avatar', { method: 'POST', body: form });
  },
  setAvatarColor: (avatarColor) =>
    apiRequest('/auth/me/avatar-color', { method: 'POST', body: { avatarColor } }),
  changePassword: (payload) => apiRequest('/auth/me/password', { method: 'POST', body: payload }),
  logoutAll: () => apiRequest('/auth/me/logout-all', { method: 'POST' }),
  forgotPassword: (email) =>
    apiRequest('/auth/forgot-password', { method: 'POST', body: { email }, auth: false }),
  resetPassword: (payload) =>
    apiRequest('/auth/reset-password', { method: 'POST', body: payload, auth: false }),

  // users
  searchUsers: (query, page = 1) =>
    apiRequest(`/users/search?q=${encodeURIComponent(query)}&page=${page}`),
  getUser: (userId) => apiRequest(`/users/${userId}`),
  startConversation: (userId) => apiRequest(`/users/${userId}/conversation`, { method: 'POST' }),
  blockUser: (userId) => apiRequest(`/users/${userId}/block`, { method: 'POST' }),
  unblockUser: (userId) => apiRequest(`/users/${userId}/block`, { method: 'DELETE' }),
  reportUser: (userId, payload) => apiRequest(`/users/${userId}/report`, { method: 'POST', body: payload }),

  // conversations & messages
  listConversations: () => apiRequest('/conversations'),
  getConversation: (id) => apiRequest(`/conversations/${id}`),
  listMessages: (id, { before, beforeId, limit = 30 } = {}) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (before) params.set('before', before);
    if (beforeId) params.set('beforeId', beforeId);
    return apiRequest(`/conversations/${id}/messages?${params.toString()}`);
  },
  sendMessage: (id, payload) =>
    apiRequest(`/conversations/${id}/messages`, { method: 'POST', body: payload }),
  markRead: (id) => apiRequest(`/conversations/${id}/read`, { method: 'POST' }),
  markDelivered: (id) => apiRequest(`/conversations/${id}/delivered`, { method: 'POST' }),
  hideConversation: (id) => apiRequest(`/conversations/${id}`, { method: 'DELETE' }),
  listBlocks: () => apiRequest('/conversations/blocks'),
  getConfig: () => apiRequest('/config', { auth: false })
};

export default api;
