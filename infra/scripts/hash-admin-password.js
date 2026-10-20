#!/usr/bin/env node
'use strict';

// Generates ADMIN_PASSWORD_HASH for infra/.env.
// Format and scrypt parameters MUST match admin-api/src/utils/hash.js.
// Duplicated rather than imported: infra must not depend on app internals.

const crypto = require('node:crypto');

const password = process.argv[2];

if (!password) {
  process.stderr.write(
    'Usage: node scripts/hash-admin-password.js <password>\n' +
      '  Example: ADMIN_PASSWORD_HASH=$(node scripts/hash-admin-password.js \'s3cret\')\n'
  );
  process.exit(1);
}

const KEYLEN = 64;
const OPTIONS = { N: 16384, r: 8, p: 1 };

const salt = crypto.randomBytes(16);
const derived = crypto.scryptSync(password, salt, KEYLEN, OPTIONS);

process.stderr.write(
  'Note: the password was passed as a shell argument and is in your shell history.\n'
);
process.stdout.write(`scrypt$${salt.toString('hex')}$${derived.toString('hex')}\n`);