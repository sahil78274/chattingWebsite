import mongoose from 'mongoose';
import { newId } from '../utils/ids.js';

const { Schema, model, models } = mongoose;

const auditLogSchema = new Schema(
  {
    _id: { type: String, default: () => newId() },
    actor: { type: String, required: true, ref: 'User' },
    action: {
      type: String,
      required: true,
      enum: [
        'admin.bootstrap',
        'admin.user.create',
        'admin.user.suspend',
        'admin.user.reactivate',
        'admin.user.delete',
        'admin.user.role'
      ]
    },
    targetUser: { type: String, default: null, ref: 'User' },
    metadata: { type: Schema.Types.Mixed, default: {} }
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false, collection: 'auditlogs' }
);

auditLogSchema.index({ createdAt: -1 }, { name: 'recent_audit' });
auditLogSchema.index({ targetUser: 1, createdAt: -1 }, { name: 'audit_by_target' });

export const AuditLog = models.AuditLog || model('AuditLog', auditLogSchema);
export default AuditLog;
