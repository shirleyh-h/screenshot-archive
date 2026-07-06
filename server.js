const express = require('express');
const multer = require('multer');
const chokidar = require('chokidar');
const path = require('path');
const fs = require('fs');
const { execSync, exec } = require('child_process');

const app = express();
const PORT = 3100;
const ARCHIVE_DIR = path.join(__dirname, 'archive');
const DESKTOP = path.join(process.env.HOME, 'Desktop');
const GITHUB_USER = 'shirleyh-h';
const GITHUB_REPO = 'screenshot-archive';
const BRANCH = 'main';
const RAW_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${GITHUB_REPO}/${BRANCH}/archive`;

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tiff', '.tif']);

// SSE clients
const sseClients = new Set();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/archive', express.static(ARCHIVE_DIR));

// SSE endpoint for real-time updates
app.get('/api/events', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach(c => c.write(msg));
}

// List images
app.get('/api/images', (req, res) => {
  const files = fs.readdirSync(ARCHIVE_DIR)
    .filter(f => IMAGE_EXT.has(path.extname(f).toLowerCase()))
    .map(f => {
      const stat = fs.statSync(path.join(ARCHIVE_DIR, f));
      return { name: f, size: stat.size, mtime: stat.mtimeMs, rawUrl: `${RAW_BASE}/${f}`, localUrl: `/archive/${f}` };
    })
    .sort((a, b) => b.mtime - a.mtime);
  res.json(files);
});

// Upload
const storage = multer.diskStorage({
  destination: ARCHIVE_DIR,
  filename: (req, file, cb) => cb(null, uniqueName(file.originalname)),
});
const upload = multer({ storage });

app.post('/api/upload', upload.array('images'), async (req, res) => {
  const added = req.files.map(f => f.filename);
  for (const name of added) await gitPush(name);
  broadcast('added', added);
  res.json({ added });
});

// Delete
app.delete('/api/images/:name', (req, res) => {
  const name = path.basename(req.params.name);
  const fpath = path.join(ARCHIVE_DIR, name);
  if (!fs.existsSync(fpath)) return res.status(404).json({ error: 'not found' });
  fs.unlinkSync(fpath);
  try {
    execSync(`git rm archive/${name} && git commit -m "Remove ${name}"`, { cwd: __dirname, stdio: 'pipe' });
    execSync(`git push origin ${BRANCH}`, { cwd: __dirname, stdio: 'pipe' });
  } catch (_) {}
  broadcast('removed', [name]);
  res.json({ removed: name });
});

// GitHub push status
app.get('/api/git-status', (req, res) => {
  try {
    const remote = execSync('git remote get-url origin', { cwd: __dirname }).toString().trim();
    res.json({ connected: true, remote });
  } catch (_) {
    res.json({ connected: false });
  }
});

// Manual push all
app.post('/api/push-all', (req, res) => {
  try {
    execSync(`git add archive/ && git diff --cached --quiet || git commit -m "Sync archive" && git push origin ${BRANCH}`, { cwd: __dirname, shell: true });
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, message: e.message });
  }
});

function uniqueName(original) {
  const ext = path.extname(original).toLowerCase();
  const base = path.basename(original, ext).replace(/[^a-zA-Z0-9_-]/g, '_');
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `${ts}_${base}${ext}`;
}

async function moveToArchive(src) {
  const name = uniqueName(path.basename(src));
  const dest = path.join(ARCHIVE_DIR, name);
  // wait briefly for file write to complete
  await new Promise(r => setTimeout(r, 500));
  try {
    fs.copyFileSync(src, dest);
    fs.unlinkSync(src);
    console.log(`[archive] ${name}`);
    await gitPush(name);
    broadcast('added', [name]);
  } catch (e) {
    console.error('[archive error]', e.message);
  }
}

function gitPush(filename) {
  return new Promise(resolve => {
    const cmd = `git add archive/${filename} && git commit -m "Add ${filename}" && git push origin ${BRANCH}`;
    exec(cmd, { cwd: __dirname, shell: true }, (err, stdout, stderr) => {
      if (err) console.warn('[git]', stderr.trim());
      else console.log('[git] pushed', filename);
      resolve();
    });
  });
}

// Watch Desktop for new screenshots
const watcher = chokidar.watch(DESKTOP, {
  depth: 0,
  ignoreInitial: true,
  persistent: true,
  awaitWriteFinish: { stabilityThreshold: 1000, pollInterval: 200 },
});

watcher.on('add', fpath => {
  const ext = path.extname(fpath).toLowerCase();
  if (IMAGE_EXT.has(ext)) {
    console.log('[detected]', fpath);
    moveToArchive(fpath);
  }
});

app.listen(PORT, () => {
  console.log(`Screenshot Archive running at http://localhost:${PORT}`);
  console.log(`Watching Desktop: ${DESKTOP}`);
  console.log(`Archive: ${ARCHIVE_DIR}`);
});
