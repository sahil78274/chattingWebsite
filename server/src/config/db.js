import mongoose from 'mongoose';
import config from '../config/env.js';
import logger from '../utils/logger.js';

export async function connectMongo(uri = config.db.mongoUri) {
  if (!uri) {
    throw new Error(
      'MONGODB_URI is not set. Add your MongoDB Atlas connection string, or set DB_DRIVER=memory for a local demo.'
    );
  }

  mongoose.set('strictQuery', true);
  mongoose.set('sanitizeFilter', true);

  await mongoose.connect(uri, {
    dbName: config.db.mongoDbName,
    serverSelectionTimeoutMS: 10_000,
    maxPoolSize: 20
  });

  logger.info('Connected to MongoDB', { database: mongoose.connection.name });

  mongoose.connection.on('error', (error) => {
    logger.error('MongoDB connection error', { error: error.message });
  });
  mongoose.connection.on('disconnected', () => {
    logger.warn('MongoDB disconnected');
  });

  return mongoose.connection;
}

export async function disconnectMongo() {
  await mongoose.connection.close();
}

export default connectMongo;
