import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

export default function handler(req, res) {
  const url = req.url.split('?')[0].replace(/\/$/, '') || '/';
  
  const map = {
    '/':        'home.html',
    '/app':     'app.html', 
    '/login':   'login.html',
    '/success': 'success.html',
  };

  const file = map[url];
  if (!file) {
    res.status(404).send('Not found');
    return;
  }

  try {
    const html = readFileSync(join(ROOT, file), 'utf8');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).send(html);
  } catch(e) {
    res.status(500).send('Error: ' + e.message);
  }
}
