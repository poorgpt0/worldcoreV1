import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

process.env.PORT = '3000';

const bundledServerPath = path.join(__dirname, 'dist', 'server.js');

if (process.env.NODE_ENV === 'production' && fs.existsSync(bundledServerPath)) {
  await import(`file://${bundledServerPath}`);
} else if (fs.existsSync(bundledServerPath) && !fs.existsSync(path.join(__dirname, 'src', 'server-app.ts'))) {
  await import(`file://${bundledServerPath}`);
} else {
  const devEntry = './src/server-app.ts';
  await import(devEntry);
}


