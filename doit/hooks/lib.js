'use strict';
// hooks 與 tools 共用的小工具：讀 stdin、找任務檔、解析頂端欄位。
// 不依賴任何第三方套件。

const fs = require('fs');
const path = require('path');

// 狀態目錄放 repo 根目錄的 .doit/，不放 .claude/：Claude Code 把 .claude/ 視為敏感區，
// 直接 Edit 會跳權限詢問。
const WF_DIR = '.doit';
const ACTIVE_FILE = 'ACTIVE';
// 全域教訓檔也不放 ~/.claude/（同樣是敏感區），改放 ~/.doit/
const GLOBAL_LESSONS = path.join(require('os').homedir(), '.doit', 'LESSONS.md');

const STATUS = {
  EXPLORING: '探索中',
  WAIT_USER: '待使用者',
  WAIT_APPROVAL: '待批准',
  APPROVED: '已批准',
  IMPLEMENTING: '實作中',
  WAIT_REVIEW: '待審查',
  DONE: '完成',
  ABORTED: '中止',
};
const ALL_STATUSES = Object.values(STATUS);
// 這些狀態下不得修改專案程式碼
const LOCKED_STATUSES = [STATUS.EXPLORING, STATUS.WAIT_USER, STATUS.WAIT_APPROVAL];
// 這些狀態代表任務已結束，hooks 不再限制
const CLOSED_STATUSES = [STATUS.DONE, STATUS.ABORTED];

const TIERS = ['低', '中', '高'];

function readStdinJson() {
  try {
    const raw = fs.readFileSync(0, 'utf8');
    return raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function normalize(p) {
  return String(p || '').replace(/\\/g, '/');
}

// 從 start 往上找到含 .doit/ACTIVE 或 .git 的目錄；找不到回 null
function findProjectRoot(start) {
  let dir = path.resolve(start || process.cwd());
  for (;;) {
    if (fs.existsSync(path.join(dir, WF_DIR, ACTIVE_FILE))) return dir;
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function wfDir(root) {
  return path.join(root, WF_DIR);
}

// 解析頂端 --- 包住的 key: value 欄位；回 { fields, bodyStart }
function parseFrontmatter(text) {
  const lines = text.split(/\r?\n/);
  if (lines[0] !== '---') return { fields: {}, headerEnd: -1, lines };
  const fields = {};
  let i = 1;
  for (; i < lines.length; i++) {
    if (lines[i] === '---') break;
    const m = lines[i].match(/^([^:]+?):\s*(.*)$/);
    if (m) fields[m[1].trim()] = m[2].trim();
  }
  return { fields, headerEnd: i, lines };
}

// 讀目前任務；沒有 ACTIVE 或檔案不存在回 null
function readActiveTask(root) {
  if (!root) return null;
  const activePath = path.join(wfDir(root), ACTIVE_FILE);
  if (!fs.existsSync(activePath)) return null;
  const name = fs.readFileSync(activePath, 'utf8').trim();
  if (!name) return null;
  const taskPath = path.join(wfDir(root), 'tasks', name);
  if (!fs.existsSync(taskPath)) return null;
  const text = fs.readFileSync(taskPath, 'utf8');
  const { fields, headerEnd, lines } = parseFrontmatter(text);
  return { name, taskPath, fields, headerEnd, lines, text };
}

function isClosed(task) {
  return !task || CLOSED_STATUSES.includes(task.fields['狀態']);
}

function isUnderWfDir(root, filePath) {
  const rel = normalize(path.relative(root, path.resolve(root, filePath)));
  return rel === normalize(WF_DIR) || rel.startsWith(normalize(WF_DIR) + '/');
}

// 檔案是否在專案根目錄之外（不同磁碟或 .. 開頭）
function isOutsideProject(root, filePath) {
  const rel = path.relative(root, path.resolve(root, filePath));
  return rel.startsWith('..') || path.isAbsolute(rel);
}

// 把 shell 指令「去皮」：移除 heredoc 內文與引號字串，只留真正的指令結構。
// 用在判斷 git push / merge / commit 時，避免 commit 訊息或紀錄文字裡的字被誤判。
function stripShellLiterals(cmd) {
  let s = String(cmd);
  // heredoc：<<'EOF' ... EOF、<<EOF ... EOF、<<-EOF
  s = s.replace(/<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n[ \t]*\2[ \t]*(?=\n|$)/g, ' ');
  // 雙引號與單引號字串
  s = s.replace(/"(?:[^"\\]|\\.)*"/g, ' ');
  s = s.replace(/'[^']*'/g, ' ');
  return s;
}

// ---- hook 輸出 ----
function denyPreToolUse(reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  }));
  process.exit(0);
}

function allow() {
  process.exit(0);
}

function blockStop(reason) {
  process.stdout.write(JSON.stringify({ decision: 'block', reason }));
  process.exit(0);
}

function sessionContext(text) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text },
  }));
  process.exit(0);
}

function nowStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

module.exports = {
  WF_DIR, ACTIVE_FILE, GLOBAL_LESSONS, STATUS, ALL_STATUSES, LOCKED_STATUSES, CLOSED_STATUSES, TIERS,
  readStdinJson, normalize, findProjectRoot, wfDir, parseFrontmatter, readActiveTask,
  isClosed, isUnderWfDir, isOutsideProject, stripShellLiterals,
  denyPreToolUse, allow, blockStop, sessionContext, nowStamp,
};
