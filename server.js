import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const port = 3000;

// 提供静态资源文件
app.use(express.static(__dirname));

// 所有其他的 GET 路由 fallback 返回 index.html
app.get('*', (req, res) => {
  res.sendFile(join(__dirname, 'index.html'));
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Note App Server is running at http://0.0.0.0:${port}`);
});
