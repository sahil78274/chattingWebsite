import ApiError from '../utils/ApiError.js';
import { getStore } from '../store/index.js';
import {
  adminCreateUserSchema,
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
  listAudit,
  setUserRole,
  setUserStatus
} from '../services/adminService.js';

export async function overview(req, res) {
  const data = await adminOverview(getStore());
  res.json(data);
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

export async function audit(req, res) {
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, Number.parseInt(req.query.limit, 10) || 30));
  const data = await listAudit(getStore(), { page, limit });
  res.json(data);
}

export default { overview, users, createUser, updateStatus, updateRole, audit };
