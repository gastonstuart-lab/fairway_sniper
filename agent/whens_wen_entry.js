import crypto from 'crypto';
import express from 'express';
import admin from 'firebase-admin';
import path from 'path';
import { fileURLToPath } from 'url';
import { DateTime } from 'luxon';
import { installWhensWen } from './whens_wen/router.js';

const entryFile = fileURLToPath(import.meta.url);
const agentDir = path.dirname(entryFile);
const originalListen = express.application.listen;

function secureEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

function makeAdminFacade() {
  const expectedCode = String(
    process.env.WHENS_WEN_ADMIN_CODE || process.env.BRS_USERNAME || '',
  ).trim();

  return {
    firestore: admin.firestore,
    auth: () => ({
      verifyIdToken: async (suppliedCode) => {
        if (!expectedCode || !secureEqual(suppliedCode, expectedCode)) {
          throw new Error('invalid-admin-code');
        }
        return {
          uid: 'whens-wen-admin',
          email: 'gastonstuart@googlemail.com',
        };
      },
    }),
  };
}

express.application.listen = function whensWenListen(...args) {
  try {
    installWhensWen(this, {
      getDb: () => (admin.apps.length ? admin.firestore() : null),
      admin: makeAdminFacade(),
      DateTime,
      agentDir,
    });
  } catch (error) {
    console.error("[WHENS_WEN] Route installation failed:", error);
  } finally {
    express.application.listen = originalListen;
  }
  return originalListen.apply(this, args);
};

await import('./index.js');
