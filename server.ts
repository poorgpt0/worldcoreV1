import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

const bundledServerPath = path.join(__dirname, 'dist', 'server.cjs');
const hasNodeModules = fs.existsSync(path.join(__dirname, 'node_modules', 'express'));

if (fs.existsSync(bundledServerPath) && (!hasNodeModules || process.env.NODE_ENV === 'production')) {
  require(bundledServerPath);
} else {
  const devEntry = './src/server-app.ts';
  await import(devEntry);
}

