import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { GridFSBucket, ObjectId } from 'mongodb';
import mongoose from 'mongoose';
import config from '../config/env.js';
import ApiError from '../utils/ApiError.js';
import logger from '../utils/logger.js';

const MIME_TO_EXT = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
  ['image/gif', '.gif']
]);

function sniffMime(buffer) {
  if (!buffer || buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'image/png';
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) return 'image/gif';
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return 'image/webp';
  }
  return null;
}

function assertImageBuffer(buffer, declaredMime) {
  const sniffed = sniffMime(buffer);
  if (!sniffed || !MIME_TO_EXT.has(sniffed)) {
    throw ApiError.badRequest('Only JPEG, PNG, WebP or GIF images are allowed', { code: 'BAD_FILE_TYPE' });
  }
  if (declaredMime && declaredMime !== sniffed && !(declaredMime === 'image/jpg' && sniffed === 'image/jpeg')) {
    throw ApiError.badRequest('The file contents do not match the declared image type', { code: 'BAD_FILE_TYPE' });
  }
  return sniffed;
}

function s3Configured() {
  return Boolean(config.s3.bucket && config.s3.accessKey && config.s3.secretKey);
}

function gridFsReady() {
  return mongoose.connection?.readyState === 1 && mongoose.connection.db;
}

function avatarsBucket() {
  return new GridFSBucket(mongoose.connection.db, { bucketName: 'avatars' });
}

async function saveToGridFs({ buffer, mimeType, filename }) {
  const bucket = avatarsBucket();
  const id = new ObjectId();
  await new Promise((resolve, reject) => {
    const stream = bucket.openUploadStreamWithId(id, filename, {
      contentType: mimeType,
      metadata: { kind: 'avatar' }
    });
    stream.on('error', reject);
    stream.on('finish', resolve);
    stream.end(buffer);
  });
  return { url: `/uploads/${id.toHexString()}`, id: id.toHexString(), mimeType };
}

async function readFromGridFs(id) {
  if (!/^[a-f0-9]{24}$/i.test(id) || !gridFsReady()) return null;
  let objectId;
  try {
    objectId = new ObjectId(id);
  } catch {
    return null;
  }
  const bucket = avatarsBucket();
  const files = await bucket.find({ _id: objectId }).toArray();
  if (!files.length) return null;
  const chunks = [];
  await new Promise((resolve, reject) => {
    const stream = bucket.openDownloadStream(objectId);
    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  return { buffer: Buffer.concat(chunks), mimeType: files[0].contentType || 'application/octet-stream' };
}

async function saveToS3({ buffer, mimeType, filename }) {
  const endpoint = config.s3.endpoint || `https://s3.${config.s3.region}.amazonaws.com`;
  const key = `avatars/${filename}`;
  const url = new URL(`${endpoint.replace(/\/+$/, '')}/${config.s3.bucket}/${key}`);
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const region = config.s3.region || 'us-east-1';
  const payloadHash = crypto.createHash('sha256').update(buffer).digest('hex');
  const canonicalHeaders = `host:${url.host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = [
    'PUT',
    url.pathname,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash
  ].join('\n');
  const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    crypto.createHash('sha256').update(canonicalRequest).digest('hex')
  ].join('\n');
  const kDate = crypto.createHmac('sha256', `AWS4${config.s3.secretKey}`).update(dateStamp).digest();
  const kRegion = crypto.createHmac('sha256', kDate).update(region).digest();
  const kService = crypto.createHmac('sha256', kRegion).update('s3').digest();
  const kSigning = crypto.createHmac('sha256', kService).update('aws4_request').digest();
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');
  const authorization = `AWS4-HMAC-SHA256 Credential=${config.s3.accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: authorization,
      'Content-Type': mimeType,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate
    },
    body: buffer
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    logger.error('S3 avatar upload failed', { status: response.status, detail: detail.slice(0, 200) });
    throw ApiError.badRequest('Could not store the profile photo', { code: 'UPLOAD_FAILED' });
  }
  const publicUrl = config.s3.publicBaseUrl
    ? `${config.s3.publicBaseUrl}/${key}`
    : url.toString();
  return { url: publicUrl, id: key, mimeType };
}

function saveToDisk({ buffer, mimeType, filename }) {
  fs.mkdirSync(config.uploads.dir, { recursive: true });
  const target = path.join(config.uploads.dir, filename);
  fs.writeFileSync(target, buffer);
  return { url: `${config.uploads.publicPath}/${filename}`, id: filename, mimeType };
}

/**
 * Persists an avatar buffer.
 *
 * Priority:
 * 1. S3-compatible object storage when S3_BUCKET + keys are set (survives Render restarts).
 * 2. MongoDB GridFS when the mongo driver is connected (uses the existing Atlas cluster).
 * 3. Local disk — development / memory-store only; files vanish on Render redeploy.
 */
export async function saveAvatar({ buffer, mimeType, userId }) {
  const detected = assertImageBuffer(buffer, mimeType);
  const ext = MIME_TO_EXT.get(detected);
  const filename = `avatar-${userId}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;

  if (s3Configured()) {
    try {
      return await saveToS3({ buffer, mimeType: detected, filename });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      logger.error('S3 upload threw', { error: error.message });
      throw ApiError.badRequest('Could not store the profile photo', { code: 'UPLOAD_FAILED' });
    }
  }

  if (gridFsReady()) {
    return saveToGridFs({ buffer, mimeType: detected, filename });
  }

  return saveToDisk({ buffer, mimeType: detected, filename });
}

export async function readAvatar(id) {
  if (!id || id.includes('..') || id.includes('/') || id.includes('\\')) return null;
  const fromGrid = await readFromGridFs(id).catch(() => null);
  if (fromGrid) return fromGrid;
  const target = path.join(config.uploads.dir, path.basename(id));
  try {
    const buffer = await fs.promises.readFile(target);
    const mimeType = sniffMime(buffer) || 'application/octet-stream';
    return { buffer, mimeType };
  } catch {
    return null;
  }
}

export function mediaBackend() {
  if (s3Configured()) return 's3';
  if (gridFsReady()) return 'gridfs';
  return 'disk';
}

export default { saveAvatar, readAvatar, mediaBackend };
