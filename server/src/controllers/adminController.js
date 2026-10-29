import ApiError from '../utils/ApiError.js';
import { getStore } from '../store/index.js';
import { selfUser } from '../utils/serialize.js';
import {
  adminCreateUserSchema,
  adminReportQuerySchema,
  adminReportStatusSchema,
  adminRoleSchema,
  adminSearchSchema,
  adminStatusSchema,
  parseId,
  parseOrThrow
} from '../utils/validation.js';
import {
  adminOverview,
  createAdminUser,
  listAdminUsers,
  listAdminReports,
  listAudit,
  setReportStatus,
  setUserRole,
  setUserStatus
} from '../services/adminService.js';

export async function overview(req, res) {
  const data = await adminOverview(getStore());
  res.json(data);
}

/** Details of the signed-in administrator (server-verified, never from the request body). */
export async function profile(req, res) {
  res.json({ user: selfUser(req.user) });
}

export async function users(req, res) {
  const query = parseOrThrow(adminSearchSchema, req.query, ApiError);
  const data = await listAdminUsers(getStore(), query);
  res.json(data);
}

export async function createUser(req, res) {
  const body = parseOrThrow(adminCreateUserSchema, req.body, ApiError);
  const user = await createAdminUser(getStore(), req.user._id, body);
  res.status(201).json({ user });
}

export async function updateStatus(req, res) {
  const userId = parseId(req.params.userId, ApiError);
  const { status } = parseOrThrow(adminStatusSchema, req.body, ApiError);
  const user = await setUserStatus(getStore(), req.user._id, userId, status);
  res.json({ user });
}

export async function updateRole(req, res) {
  const userId = parseId(req.params.userId, ApiError);
  const { role } = parseOrThrow(adminRoleSchema, req.body, ApiError);
  const user = await setUserRole(getStore(), req.user._id, userId, role);
  res.json({ user });
}

export async function reports(req, res) {
  const query = parseOrThrow(adminReportQuerySchema, req.query, ApiError);
  const data = await listAdminReports(getStore(), query);
  res.json(data);
}

export async function updateReport(req, res) {
  const reportId = parseId(req.params.reportId, ApiError);
  const { status } = parseOrThrow(adminReportStatusSchema, req.body, ApiError);
  const report = await setReportStatus(getStore(), req.user._id, reportId, status);
  res.json({ report });
}

export async function audit(req, res) {
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, Number.parseInt(req.query.limit, 10) || 30));
  const data = await listAudit(getStore(), { page, limit });
  res.json(data);
}

export default {
  overview,
  profile,
  users,
  createUser,
  updateStatus,
  updateRole,
  reports,
  updateReport,
  audit
};
