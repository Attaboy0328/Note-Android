import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';

// Load .env variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const port = 3000;

// 提供静态资源文件
app.use(express.static(__dirname));

// 获取服务器端配置的 Supabase 凭证
app.get('/api/supabase-config', (req, res) => {
  res.json({
    url: process.env.SUPABASE_URL || '',
    anonKey: process.env.SUPABASE_ANON_KEY || ''
  });
});

// 所有其他的 GET 路由 fallback 返回 index.html
app.get('*', (req, res) => {
  res.sendFile(join(__dirname, 'index.html'));
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Note App Server is running at http://0.0.0.0:${port}`);
});
