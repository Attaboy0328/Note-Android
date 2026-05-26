import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FILES_TO_COPY = [
  'index.html',
  'app.js',
  'styles.css',
  'themes.js',
  'editor.js',
  'db.js',
  'sync.js',
  'share.js',
  'manifest.webmanifest',
  'service-worker.js'
];

async function build() {
  const distDir = path.join(__dirname, 'dist');

  // Re-create dist directory
  if (fs.existsSync(distDir)) {
    fs.rmSync(distDir, { recursive: true, force: true });
  }
  fs.mkdirSync(distDir, { recursive: true });

  console.log('Building static assets...');

  for (const file of FILES_TO_COPY) {
    const src = path.join(__dirname, file);
    const dest = path.join(distDir, file);

    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dest);
      console.log(`Copied ${file} to dist/`);
    } else {
      console.warn(`Warning: Static file ${file} does not exist at root`);
    }
  }

  console.log('Build completed! Files are in dist/ directory.');
}

build().catch(err => {
  console.error('Build failed:', err);
  process.exit(1);
});
