import nodemailer from 'nodemailer';
import config from '../config/env.js';
import logger from './logger.js';

let transporter = null;

function getTransporter() {
  if (!config.mail.configured) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.mail.host,
      port: config.mail.port,
      secure: config.mail.secure,
      auth: { user: config.mail.user, pass: config.mail.pass }
    });
  }
  return transporter;
}

export function mailConfigured() {
  return config.mail.configured;
}

/**
 * Sends a transactional email. When SMTP is not configured we log a warning and
 * return { delivered: false } so callers can surface the "email not configured"
 * state instead of pretending the mail was sent.
 */
export async function sendMail({ to, subject, text, html }) {
  const transport = getTransporter();
  if (!transport) {
    logger.warn('SMTP is not configured; email was not sent', { subject });
    return { delivered: false, reason: 'smtp_not_configured' };
  }
  const info = await transport.sendMail({ from: config.mail.from, to, subject, text, html });
  logger.info('Transactional email sent', { messageId: info.messageId });
  return { delivered: true, messageId: info.messageId };
}

export async function sendPasswordResetEmail({ to, username, resetUrl }) {
  const text = [
    `Hi ${username},`,
    '',
    'We received a request to reset your Connectly password.',
    `Reset it here (valid for 30 minutes): ${resetUrl}`,
    '',
    'If you did not request this, you can safely ignore this email.'
  ].join('\n');
  const html = `
    <div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;line-height:1.6;color:#0f172a">
      <h2 style="margin:0 0 12px">Reset your Connectly password</h2>
      <p>Hi ${username},</p>
      <p>We received a request to reset your password. This link is valid for 30 minutes.</p>
      <p><a href="${resetUrl}" style="display:inline-block;padding:12px 18px;border-radius:10px;background:#4f46e5;color:#fff;text-decoration:none">Reset password</a></p>
      <p style="color:#64748b;font-size:13px">If you did not request this, you can safely ignore this email.</p>
    </div>`;
  return sendMail({ to, subject: 'Reset your Connectly password', text, html });
}

export default { sendMail, sendPasswordResetEmail, mailConfigured };
