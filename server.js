const express = require('express');
const multer = require('multer');
const chokidar = require('chokidar');
const path = require('path');
const fs = require('fs');
const { execSync, exec } = require('child_process');

// config.json 로드 (없으면 setup 안내)
const CONFIG_FILE = path.join(__dirname, 'config.json');
if (!fs.existsSync(CONFIG_FILE)) {
  console.error('\n⚠️  config.json 이 없어요. 아래 명령으로 설정을 먼저 실행하세요:\n\n  node setup.js\n');
  process.exit(1);
}
const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));

const app = express();
const PORT = config.port || 3100;
const ARCHIVE_DIR = path.join(__dirname, 'archive');
const DESKTOP = config.watchFolder || path.join(process.env.HOME, 'Desktop');
const GITHUB_USER = config.githubUser;
const GITHUB_REPO = config.githubRepo;
const BRANCH = 'main';
const RAW_BASE = GITHUB_USER && GITHUB_REPO
  ? `https://raw.githubusercontent.com/${GITHUB_USER}/${GITHUB_REPO}/${BRANCH}/archive`
  : null;
const METADATA_FILE = path.join(ARCHIVE_DIR, 'metadata.json');
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tiff', '.tif']);

const sseClients = new Set();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/archive', express.static(ARCHIVE_DIR));

// --- Metadata ---
function readMeta() {
  try { return JSON.parse(fs.readFileSync(METADATA_FILE, 'utf8')); }
  catch { return {}; }
}
function writeMeta(meta) {
  fs.writeFileSync(METADATA_FILE, JSON.stringify(meta, null, 2));
}

function parseDisplayName(original) {
  const base = path.basename(original, path.extname(original));
  // macOS Korean: 스크린샷 2026-07-07 오후 11.43.05
  const kor = base.match(/스크린샷\s+(\d{4}-\d{2}-\d{2})\s+(오전|오후)\s+(\d{1,2})\.(\d{2})/);
  if (kor) {
    const [, date, ampm, h, m] = kor;
    let hr = parseInt(h);
    if (ampm === '오후' && hr < 12) hr += 12;
    if (ampm === '오전' && hr === 12) hr = 0;
    return `${date} ${String(hr).padStart(2, '0')}:${m}`;
  }
  // macOS English: Screenshot 2026-07-07 at 11.43.05 PM
  const eng = base.match(/Screenshot\s+(\d{4}-\d{2}-\d{2})\s+at\s+(\d{1,2})\.(\d{2})\.(\d{2})\s+(AM|PM)/);
  if (eng) {
    const [, date, h, m, , ampm] = eng;
    let hr = parseInt(h);
    if (ampm === 'PM' && hr < 12) hr += 12;
    if (ampm === 'AM' && hr === 12) hr = 0;
    return `${date} ${String(hr).padStart(2, '0')}:${m}`;
  }
  // Our timestamp prefix: 2026-07-07T11-43-05
  const ts = base.match(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})/);
  if (ts) return `${ts[1]} ${ts[2]}:${ts[3]}`;
  return base.replace(/_+/g, ' ').trim();
}

function autoFolder(filename) {
  const m = filename.match(/^(\d{4}-\d{2})/);
  return m ? m[1] : '기타';
}

// --- SSE ---
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

// --- Images ---
app.get('/api/images', (req, res) => {
  const meta = readMeta();
  const { folder, tag } = req.query;
  const files = fs.readdirSync(ARCHIVE_DIR)
    .filter(f => IMAGE_EXT.has(path.extname(f).toLowerCase()))
    .map(f => {
      const stat = fs.statSync(path.join(ARCHIVE_DIR, f));
      const m = meta[f] || {};
      return {
        name: f,
        displayName: m.displayName || parseDisplayName(f),
        folder: m.folder || autoFolder(f),
        tags: m.tags || [],
        size: stat.size,
        mtime: stat.mtimeMs,
        rawUrl: RAW_BASE ? `${RAW_BASE}/${f}` : null,
        localUrl: `/archive/${f}`,
      };
    })
    .filter(img => !folder || folder === 'all' || img.folder === folder)
    .filter(img => !tag || img.tags.includes(tag))
    .sort((a, b) => b.mtime - a.mtime);
  res.json(files);
});

// --- Tags ---
app.get('/api/tags', (req, res) => {
  const meta = readMeta();
  const counts = {};
  Object.entries(meta).forEach(([k, v]) => {
    if (k.startsWith('__') || !v.tags) return;
    v.tags.forEach(t => { counts[t] = (counts[t] || 0) + 1; });
  });
  const tags = Object.entries(counts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
  res.json(tags);
});

// --- Folders ---
app.get('/api/folders', (req, res) => {
  const meta = readMeta();
  const files = fs.readdirSync(ARCHIVE_DIR).filter(f => IMAGE_EXT.has(path.extname(f).toLowerCase()));
  const counts = {};
  files.forEach(f => {
    const folder = (meta[f] && meta[f].folder) || autoFolder(f);
    counts[folder] = (counts[folder] || 0) + 1;
  });
  const userFolders = meta.__folders || [];
  const dateFolders = Object.entries(counts)
    .filter(([name]) => /^\d{4}-\d{2}$/.test(name))
    .map(([name, count]) => ({ name, count, isDate: true }))
    .sort((a, b) => b.name.localeCompare(a.name));
  const otherFolders = Object.entries(counts)
    .filter(([name]) => !/^\d{4}-\d{2}$/.test(name))
    .map(([name, count]) => ({ name, count, isDate: false }))
    .sort((a, b) => a.name.localeCompare(b.name));
  userFolders.forEach(name => {
    if (!counts[name]) otherFolders.push({ name, count: 0, isDate: false });
  });
  res.json({ total: files.length, dateFolders, otherFolders });
});

app.post('/api/folders', (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'name required' });
  const meta = readMeta();
  meta.__folders = meta.__folders || [];
  if (!meta.__folders.includes(name.trim())) meta.__folders.push(name.trim());
  writeMeta(meta);
  res.json({ ok: true });
});

app.delete('/api/folders/:name', (req, res) => {
  const name = decodeURIComponent(req.params.name);
  const meta = readMeta();
  Object.keys(meta).forEach(k => {
    if (k !== '__folders' && meta[k] && meta[k].folder === name) meta[k].folder = '기타';
  });
  meta.__folders = (meta.__folders || []).filter(f => f !== name);
  writeMeta(meta);
  pushMetadata('Remove folder');
  broadcast('updated', []);
  res.json({ ok: true });
});

// --- Update image metadata ---
app.put('/api/images/:name', (req, res) => {
  const name = path.basename(req.params.name);
  const { displayName, folder, tags } = req.body;
  const meta = readMeta();
  meta[name] = meta[name] || {};
  if (displayName !== undefined) meta[name].displayName = displayName.trim();
  if (folder !== undefined) meta[name].folder = folder;
  if (tags !== undefined) meta[name].tags = tags;
  writeMeta(meta);
  pushMetadata(`Update ${name}`);
  broadcast('updated', [name]);
  res.json({ ok: true });
});

// --- Upload ---
const storage = multer.diskStorage({
  destination: ARCHIVE_DIR,
  filename: (req, file, cb) => cb(null, uniqueName()),
});
const upload = multer({ storage });
app.post('/api/upload', upload.array('images'), async (req, res) => {
  const meta = readMeta();
  const added = req.files.map((f, i) => {
    const original = req.files[i].originalname;
    meta[f.filename] = { displayName: parseDisplayName(original), folder: autoFolder(f.filename) };
    return f.filename;
  });
  writeMeta(meta);
  for (const name of added) await gitPush(name);
  broadcast('added', added);
  res.json({ added });
});

// --- Delete ---
app.delete('/api/images/:name', (req, res) => {
  const name = path.basename(req.params.name);
  const fpath = path.join(ARCHIVE_DIR, name);
  if (!fs.existsSync(fpath)) return res.status(404).json({ error: 'not found' });
  fs.unlinkSync(fpath);
  const meta = readMeta();
  delete meta[name];
  writeMeta(meta);
  try {
    execSync(`git rm "archive/${name}" 2>/dev/null || true`, { cwd: __dirname, shell: true, stdio: 'pipe' });
    execSync(`git add archive/metadata.json && git commit -m "Remove ${name}"`, { cwd: __dirname, stdio: 'pipe' });
    execSync(`git push origin ${BRANCH}`, { cwd: __dirname, stdio: 'pipe' });
  } catch (_) {}
  broadcast('removed', [name]);
  res.json({ removed: name });
});

// --- GitHub ---
app.get('/api/git-status', (req, res) => {
  try {
    const remote = execSync('git remote get-url origin', { cwd: __dirname }).toString().trim();
    res.json({ connected: true, remote });
  } catch (_) { res.json({ connected: false }); }
});

app.post('/api/push-all', (req, res) => {
  try {
    execSync(`git add archive/ && (git diff --cached --quiet || git commit -m "Sync archive") && git push origin ${BRANCH}`, { cwd: __dirname, shell: true });
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, message: e.message });
  }
});

// --- Helpers ---
function uniqueName() {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `${ts}.png`;
}

function uniqueNameWithExt(ext) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `${ts}${ext}`;
}

async function moveToArchive(src) {
  const original = path.basename(src);
  const ext = path.extname(original).toLowerCase();
  const name = uniqueNameWithExt(ext);
  const dest = path.join(ARCHIVE_DIR, name);
  await new Promise(r => setTimeout(r, 500));
  try {
    fs.copyFileSync(src, dest);
    fs.unlinkSync(src);
    const meta = readMeta();
    meta[name] = { displayName: parseDisplayName(original), folder: autoFolder(name) };
    writeMeta(meta);
    console.log(`[archive] ${name} → "${meta[name].displayName}" (${meta[name].folder})`);
    await gitPush(name);
    broadcast('added', [name]);
  } catch (e) { console.error('[archive error]', e.message); }
}

function gitPush(filename) {
  return new Promise(resolve => {
    const cmd = `git add "archive/${filename}" archive/metadata.json && git commit -m "Add ${filename}" && git push origin ${BRANCH}`;
    exec(cmd, { cwd: __dirname, shell: true }, (err, stdout, stderr) => {
      if (err) console.warn('[git]', stderr.trim());
      else console.log('[git] pushed', filename);
      resolve();
    });
  });
}

function pushMetadata(msg) {
  exec(`git add archive/metadata.json && (git diff --cached --quiet || git commit -m "${msg}") && git push origin ${BRANCH}`,
    { cwd: __dirname, shell: true },
    (err) => { if (err) console.warn('[git meta]', err.message); }
  );
}

// --- Watch Desktop ---
const watcher = chokidar.watch(DESKTOP, {
  depth: 0, ignoreInitial: true, persistent: true,
  awaitWriteFinish: { stabilityThreshold: 1000, pollInterval: 200 },
});
watcher.on('add', fpath => {
  if (IMAGE_EXT.has(path.extname(fpath).toLowerCase())) {
    console.log('[detected]', fpath);
    moveToArchive(fpath);
  }
});

app.listen(PORT, () => {
  console.log(`Screenshot Archive → http://localhost:${PORT}`);
  console.log(`Watching: ${DESKTOP}`);
});
