/**
 * Render sanity check: server-renders the main screens so any runtime error in
 * a component tree surfaces in CI without needing a browser. Not shipped.
 *
 *   npm run check:render
 */
import React from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { AuthContext } from '../src/context/AuthContext.jsx';
import { ThemeProvider } from '../src/context/ThemeContext.jsx';
import { ToastProvider } from '../src/context/ToastContext.jsx';
import { LoginPage } from '../src/pages/LoginPage.jsx';
import { RegisterPage } from '../src/pages/RegisterPage.jsx';
import { ForgotPasswordPage } from '../src/pages/ForgotPasswordPage.jsx';
import { ResetPasswordPage } from '../src/pages/ResetPasswordPage.jsx';
import { ChatPage } from '../src/pages/ChatPage.jsx';
import { NotFoundPage } from '../src/pages/NotFoundPage.jsx';

const user = {
  id: '6adee6541c884686bbd0ea5e',
  username: 'aarav.sharma',
  displayName: 'Aarav Sharma',
  bio: 'Product designer',
  avatarUrl: '',
  avatarColor: '#6366f1',
  initials: 'AS',
  online: true,
  lastSeen: new Date().toISOString(),
  createdAt: new Date().toISOString(),
  email: 'aarav@example.com',
  privacy: { lastSeen: 'everyone' }
};

const authValue = {
  user,
  status: 'authenticated',
  isAuthenticated: true,
  login: async () => {},
  register: async () => {},
  logout: async () => {},
  refreshUser: async () => user,
  updateUser: () => {},
  clearSession: () => {}
};

const screens = [
  ['LoginPage', <LoginPage key="login" />],
  ['RegisterPage', <RegisterPage key="register" />],
  ['ForgotPasswordPage', <ForgotPasswordPage key="forgot" />],
  ['ResetPasswordPage', <ResetPasswordPage key="reset" />],
  ['NotFoundPage', <NotFoundPage key="404" />]
];

let failures = 0;
for (const [name, element] of screens) {
  try {
    const html = renderToString(
      <ThemeProvider>
        <ToastProvider>
          <AuthContext.Provider value={{ ...authValue, status: 'anonymous', isAuthenticated: false, user: null }}>
            <MemoryRouter>{element}</MemoryRouter>
          </AuthContext.Provider>
        </ToastProvider>
      </ThemeProvider>
    );
    console.log(`PASS  ${name} rendered (${html.length} chars)`);
  } catch (error) {
    failures += 1;
    console.log(`FAIL  ${name}: ${error.message}`);
  }
}

try {
  const html = renderToString(
    <ThemeProvider>
      <ToastProvider>
        <AuthContext.Provider value={authValue}>
          <MemoryRouter>
            <ChatPage />
          </MemoryRouter>
        </AuthContext.Provider>
      </ToastProvider>
    </ThemeProvider>
  );
  const hasSidebar = html.includes('Search by username or user ID');
  console.log(`PASS  ChatPage rendered (${html.length} chars, sidebar=${hasSidebar})`);
  if (!hasSidebar) failures += 1;
} catch (error) {
  failures += 1;
  console.log(`FAIL  ChatPage: ${error.message}`);
}

if (failures > 0) {
  console.log(`\n${failures} screen(s) failed to render`);
  process.exit(1);
}
console.log('\nAll screens render');
