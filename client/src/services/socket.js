import { io } from 'socket.io-client';
import { SOCKET_URL, refreshAccessToken } from './api.js';

/**
 * Creates an authenticated Socket.IO client.
 *
 * - The access token is sent in the handshake (never in the URL/query string).
 * - Reconnection is automatic; the workspace re-syncs state on every reconnect
 *   and replays any unsent messages (the server de-duplicates by clientId).
 * - If the handshake fails because the token expired we refresh it once and
 *   retry the connection instead of dropping the user to the login screen.
 */
export function createSocket(getToken) {
  const socket = io(SOCKET_URL, {
    autoConnect: false,
    withCredentials: true,
    auth: (cb) => cb({ token: getToken() }),
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 600,
    reconnectionDelayMax: 6000,
    randomizationFactor: 0.4,
    timeout: 12_000
  });

  socket.on('connect_error', async (error) => {
    const reason = String(error?.message || '');
    if (reason.includes('TOKEN_EXPIRED') || reason.includes('UNAUTHORIZED')) {
      const refreshed = await refreshAccessToken();
      // socket.auth is a function that reads the current token, so a plain
      // reconnect is enough once the access token has been refreshed.
      if (refreshed?.accessToken && socket.io.engine?.readyState !== 'open') {
        socket.connect();
      }
    }
  });

  return socket;
}

export default createSocket;
