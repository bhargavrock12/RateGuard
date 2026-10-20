'use strict';

const { PrismaClient } = require('@prisma/client');
const env = require('./env');
const logger = require('../utils/logger');

const prisma = new PrismaClient({
  log: [
    { emit: 'event', level: 'warn' },
    { emit: 'event', level: 'error' },
  ],
});

prisma.$on('warn', (e) => logger.warn('prisma_warn', { detail: e.message }));
prisma.$on('error', (e) => logger.error('prisma_error', { detail: e.message }));

async function connectPrisma() {
  await prisma.$connect();
  logger.info('database_connected', { url: env.DATABASE_URL.replace(/:\/\/.*@/, '://***@') });
}

async function checkDatabase() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch (err) {
    logger.error('database_check_failed', { err: err.message });
    return false;
  }
}

async function disconnectPrisma() {
  await prisma.$disconnect();
}

module.exports = { prisma, connectPrisma, checkDatabase, disconnectPrisma };