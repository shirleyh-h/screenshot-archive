#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { execSync } = require('child_process');
const os = require('os');

const CONFIG_FILE = path.join(__dirname, 'config.json');
const PLIST_DIR = path.join(os.homedir(), 'Library', 'LaunchAgents');
const PLIST_FILE = path.join(PLIST_DIR, 'com.screenshot-archive.plist');
const ARCHIVE_DIR = path.join(__dirname, 'archive');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q, def) => new Promise(resolve =>
  rl.question(def ? `${q} (기본값: ${def}): ` : `${q}: `, ans => resolve(ans.trim() || def || ''))
);

function detectNode() {
  for (const p of ['/opt/homebrew/bin/node', '/usr/local/bin/node', '/usr/bin/node']) {
    if (fs.existsSync(p)) return p;
  }
  return process.execPath;
}

async function main() {
  console.log('\n🚀 Screenshot Archive 설정을 시작합니다.\n');

  // 1. GitHub 연동 여부
  const useGithub = (await ask('GitHub에 이미지를 동기화할까요? (y/n)', 'y')).toLowerCase() === 'y';

  let githubUser = '', githubRepo = '';
  if (useGithub) {
    // SSH로 GitHub 사용자명 자동 감지
    let detected = '';
    try {
      const out = execSync('ssh -T git@github.com 2>&1 || true').toString();
      const m = out.match(/Hi ([^!]+)!/);
      if (m) detected = m[1].trim();
    } catch {}

    githubUser = await ask('GitHub 사용자명', detected);
    githubRepo = await ask('GitHub 저장소 이름', 'screenshot-archive');

    // 저장소 remote 설정
    try {
      const existing = execSync('git remote get-url origin 2>/dev/null || echo ""', { cwd: __dirname }).toString().trim();
      const newUrl = `git@github.com:${githubUser}/${githubRepo}.git`;
      if (!existing) {
        execSync(`git remote add origin "${newUrl}"`, { cwd: __dirname });
        console.log(`✅ Git remote 추가됨: ${newUrl}`);
      } else if (existing !== newUrl) {
        execSync(`git remote set-url origin "${newUrl}"`, { cwd: __dirname });
        console.log(`✅ Git remote 업데이트됨: ${newUrl}`);
      }
    } catch (e) {
      console.warn('⚠️  Git remote 설정 실패:', e.message);
    }
  }

  // 2. 포트
  const port = parseInt(await ask('서버 포트', '3100'));

  // 3. 감시 폴더
  const defaultWatch = path.join(os.homedir(), 'Desktop');
  const watchFolder = await ask('스크린샷 감시 폴더', defaultWatch);

  // 4. config.json 저장
  const config = { port, githubUser, githubRepo, watchFolder };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  console.log('\n✅ config.json 저장 완료');

  // 5. archive 폴더 생성
  if (!fs.existsSync(ARCHIVE_DIR)) {
    fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
    console.log('✅ archive/ 폴더 생성');
  }

  // 6. git 초기화
  if (!fs.existsSync(path.join(__dirname, '.git'))) {
    execSync('git init && git add . && git commit -m "Initial commit"', { cwd: __dirname, shell: true });
    console.log('✅ Git 저장소 초기화');
  }

  // 7. launchd 자동 실행 등록
  const autoStart = (await ask('\n로그인 시 자동 실행할까요? (y/n)', 'y')).toLowerCase() === 'y';
  if (autoStart) {
    const nodePath = detectNode();
    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.screenshot-archive</string>
    <key>ProgramArguments</key>
    <array>
        <string>${nodePath}</string>
        <string>${path.join(__dirname, 'server.js')}</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${__dirname}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${path.join(__dirname, 'server.log')}</string>
    <key>StandardErrorPath</key>
    <string>${path.join(__dirname, 'server.log')}</string>
</dict>
</plist>`;

    if (!fs.existsSync(PLIST_DIR)) fs.mkdirSync(PLIST_DIR, { recursive: true });
    fs.writeFileSync(PLIST_FILE, plist);

    try {
      execSync(`launchctl unload "${PLIST_FILE}" 2>/dev/null; launchctl load "${PLIST_FILE}"`, { shell: true });
      console.log('✅ 자동 실행 등록 완료 (launchd)');
    } catch (e) {
      console.warn('⚠️  launchd 등록 실패 (수동으로 npm start 실행하세요)');
    }
  }

  rl.close();

  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ 설정 완료!

  브라우저 열기 → http://localhost:${port}
  서버 수동 시작 → npm start
  로그 확인 → tail -f server.log
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  `);

  if (useGithub && githubUser && githubRepo) {
    console.log(`⚠️  GitHub 저장소가 아직 없다면 먼저 만들어주세요:`);
    console.log(`   https://github.com/new → 이름: ${githubRepo} → Public\n`);
  }
}

main().catch(e => { console.error(e); rl.close(); process.exit(1); });
