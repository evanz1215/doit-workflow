#!/usr/bin/env node
'use strict';
// 用假的 stdin 事件跑每個 hook 與 log.js，確認擋／放行為正確。
// 執行：node doit/test/run-tests.js

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const PLUGIN = path.resolve(__dirname, '..');
const HOOKS = path.join(PLUGIN, 'hooks');
const LOG = path.join(PLUGIN, 'tools', 'log.js');

let failures = 0;
function check(name, cond, extra) {
  if (cond) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${extra ? '\n       ' + extra : ''}`);
  }
}

function run(script, stdinObj, cwd) {
  const r = spawnSync(process.execPath, [script], {
    input: JSON.stringify(stdinObj),
    cwd,
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: cwd },
  });
  let json = null;
  try { json = r.stdout.trim() ? JSON.parse(r.stdout) : null; } catch { /* 非 JSON 輸出 */ }
  return { code: r.status, out: r.stdout, err: r.stderr, json };
}

function runLog(args, cwd) {
  const r = spawnSync(process.execPath, [LOG, ...args], { cwd, encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

function git(args, cwd) {
  return spawnSync('git', args, { cwd, encoding: 'utf8' });
}

function denied(r) {
  return r.json && r.json.hookSpecificOutput && r.json.hookSpecificOutput.permissionDecision === 'deny';
}
function allowed(r) {
  return r.code === 0 && !denied(r) && !(r.json && r.json.decision === 'block');
}

// ---- 建一個暫時的 git repo ----
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'doit-test-'));
git(['init', '-q'], tmp);
git(['config', 'user.email', 'test@example.com'], tmp);
git(['config', 'user.name', 'test'], tmp);
fs.writeFileSync(path.join(tmp, 'README.md'), '# test\n');
git(['add', '.'], tmp);
git(['commit', '-q', '-m', 'init'], tmp);
const srcFile = path.join(tmp, 'src', 'a.js');

const editEvent = (file) => ({ hook_event_name: 'PreToolUse', tool_name: 'Edit', cwd: tmp, tool_input: { file_path: file, old_string: 'a', new_string: 'b' } });
const bashEvent = (command) => ({ hook_event_name: 'PreToolUse', tool_name: 'Bash', cwd: tmp, tool_input: { command } });
const stopEvent = (active) => ({ hook_event_name: 'Stop', cwd: tmp, stop_hook_active: !!active });
const startEvent = () => ({ hook_event_name: 'SessionStart', cwd: tmp, source: 'startup' });

console.log('\n[1] 沒有任務時一律放行');
check('edit 放行', allowed(run(path.join(HOOKS, 'guard-edit.js'), editEvent(srcFile), tmp)));
check('commit 放行', allowed(run(path.join(HOOKS, 'guard-commit.js'), bashEvent('git commit -m "x"'), tmp)));
check('stop 放行', allowed(run(path.join(HOOKS, 'guard-stop.js'), stopEvent(false), tmp)));
const s0 = run(path.join(HOOKS, 'session-start.js'), startEvent(), tmp);
check('session-start 無輸出', s0.code === 0 && !s0.out.trim());

console.log('\n[2] log.js --new 建任務');
const n = runLog(['--new', 'Add Paging', '--set', '類型=feat', '--set', 'base=main', '--set', '下一步=探索'], tmp);
check('建立成功', n.code === 0, n.err);
const activePath = path.join(tmp, '.claude', 'doit', 'ACTIVE');
check('ACTIVE 存在', fs.existsSync(activePath));
const taskName = fs.existsSync(activePath) ? fs.readFileSync(activePath, 'utf8').trim() : '';
check('檔名含 slug', /-add-paging\.md$/.test(taskName), taskName);
const excl = fs.readFileSync(path.join(tmp, '.git', 'info', 'exclude'), 'utf8');
check('.git/info/exclude 含 .claude/doit/', excl.includes('.claude/doit/'));
const st = git(['status', '--porcelain'], tmp).stdout;
check('git status 乾淨（任務檔被排除）', st.trim() === '', st);
check('--new 重複會失敗', runLog(['--new', 'Add Paging'], tmp).code !== 0);

console.log('\n[3] 探索中：擋改檔、擋 commit、擋 stop（下一步空）');
check('edit 專案檔被擋', denied(run(path.join(HOOKS, 'guard-edit.js'), editEvent(srcFile), tmp)));
check('edit 任務檔放行', allowed(run(path.join(HOOKS, 'guard-edit.js'), editEvent(path.join(tmp, '.claude', 'doit', 'tasks', taskName)), tmp)));
check('edit 反斜線路徑也被擋', denied(run(path.join(HOOKS, 'guard-edit.js'), editEvent(srcFile.replace(/\//g, '\\')), tmp)));
check('wip commit 在未批准時被擋', denied(run(path.join(HOOKS, 'guard-commit.js'), bashEvent('git commit -m "wip: x"'), tmp)));
check('非 git 指令放行', allowed(run(path.join(HOOKS, 'guard-commit.js'), bashEvent('npm test'), tmp)));
check('git merge-base 放行（不是 merge）', allowed(run(path.join(HOOKS, 'guard-commit.js'), bashEvent('git merge-base --is-ancestor abc HEAD'), tmp)));
runLog(['--set', '下一步='], tmp);
const stopBlocked = run(path.join(HOOKS, 'guard-stop.js'), stopEvent(false), tmp);
check('下一步空 → stop 被擋', stopBlocked.json && stopBlocked.json.decision === 'block', stopBlocked.out);
check('stop_hook_active → 放行（防迴圈）', allowed(run(path.join(HOOKS, 'guard-stop.js'), stopEvent(true), tmp)));
runLog(['--set', '下一步=寫計畫'], tmp);
check('下一步有值 → stop 放行', allowed(run(path.join(HOOKS, 'guard-stop.js'), stopEvent(false), tmp)));
const s1 = run(path.join(HOOKS, 'session-start.js'), startEvent(), tmp);
check('session-start 提示未完成任務', s1.json && /未完成/.test(s1.json.hookSpecificOutput.additionalContext), s1.out);

console.log('\n[4] log.js 欄位驗證與紀錄行');
check('狀態不合法被拒', runLog(['--set', '狀態=隨便'], tmp).code !== 0);
check('等級不合法被拒', runLog(['--set', '等級=超高'], tmp).code !== 0);
check('標籤不合法被拒', runLog(['[亂寫] x'], tmp).code !== 0);
check('合法紀錄行', runLog(['[完成] 步驟 1：x', '[證據 標準1] npm test 通過'], tmp).code === 0);
check('錯誤標籤', runLog(['[錯誤 來源：agent 分類：實作] 忘了跑測試'], tmp).code === 0);
const show = runLog(['--show'], tmp);
check('--show 有狀態', /狀態: /.test(show.out));
const taskText = fs.readFileSync(path.join(tmp, '.claude', 'doit', 'tasks', taskName), 'utf8');
check('紀錄行有時間戳', /\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}\] \[完成\] 步驟 1/.test(taskText));
check('狀態變更自動留紀錄', (runLog(['--set', '狀態=待批准'], tmp), /\[紀錄\] 狀態 → 待批准/.test(fs.readFileSync(path.join(tmp, '.claude', 'doit', 'tasks', taskName), 'utf8'))));

console.log('\n[5] 待批准：仍擋改檔；已批准：放行改檔與 wip commit，擋交付 commit 與 push');
check('待批准 edit 被擋', denied(run(path.join(HOOKS, 'guard-edit.js'), editEvent(srcFile), tmp)));
runLog(['--set', '狀態=已批准', '--set', '批准=v1「照計畫做」'], tmp);
check('已批准 edit 放行', allowed(run(path.join(HOOKS, 'guard-edit.js'), editEvent(srcFile), tmp)));
check('wip commit 放行', allowed(run(path.join(HOOKS, 'guard-commit.js'), bashEvent('git commit -m "wip: 步驟 1"'), tmp)));
check('wip 單引號放行', allowed(run(path.join(HOOKS, 'guard-commit.js'), bashEvent("git add -A && git commit -m 'wip: 步驟 1'"), tmp)));
check('wip heredoc 放行', allowed(run(path.join(HOOKS, 'guard-commit.js'), bashEvent('git commit -m "$(cat <<\'EOF\'\nwip: 步驟 2\n\n細節\nEOF\n)"'), tmp)));
check('交付 commit 被擋', denied(run(path.join(HOOKS, 'guard-commit.js'), bashEvent('git commit -m "feat: paging"'), tmp)));
check('heredoc 非 wip 被擋', denied(run(path.join(HOOKS, 'guard-commit.js'), bashEvent('git commit -m "$(cat <<\'EOF\'\nfeat: paging\nEOF\n)"'), tmp)));
check('push 被擋', denied(run(path.join(HOOKS, 'guard-commit.js'), bashEvent('git push origin feat/x'), tmp)));
check('merge 被擋', denied(run(path.join(HOOKS, 'guard-commit.js'), bashEvent('git merge feat/x'), tmp)));
runLog(['--set', '狀態=實作中'], tmp);
check('實作中 edit 放行', allowed(run(path.join(HOOKS, 'guard-edit.js'), editEvent(srcFile), tmp)));
runLog(['--set', '狀態=待審查'], tmp);
check('待審查 edit 放行（修審查意見）', allowed(run(path.join(HOOKS, 'guard-edit.js'), editEvent(srcFile), tmp)));
check('待審查 交付 commit 仍被擋', denied(run(path.join(HOOKS, 'guard-commit.js'), bashEvent('git commit -m "feat: paging"'), tmp)));

console.log('\n[6] 完成：全部放行');
runLog(['--close', '完成', '[紀錄] 門檻通過'], tmp);
check('交付 commit 放行', allowed(run(path.join(HOOKS, 'guard-commit.js'), bashEvent('git commit -m "feat: paging"'), tmp)));
check('push 放行', allowed(run(path.join(HOOKS, 'guard-commit.js'), bashEvent('git push'), tmp)));
check('stop 放行', allowed(run(path.join(HOOKS, 'guard-stop.js'), stopEvent(false), tmp)));
const s2 = run(path.join(HOOKS, 'session-start.js'), startEvent(), tmp);
check('session-start 無提示', s2.code === 0 && !s2.out.trim());

console.log('\n[7] 無人看管低風險例外（v0.3 預留）');
runLog(['--new', 'auto-low', '--set', '等級=低', '--set', '無人看管=是', '--set', '下一步=x'], tmp);
check('探索中但 auto+低 → edit 放行', allowed(run(path.join(HOOKS, 'guard-edit.js'), editEvent(srcFile), tmp)));
runLog(['--set', '等級=中'], tmp);
check('auto+中 → edit 被擋', denied(run(path.join(HOOKS, 'guard-edit.js'), editEvent(srcFile), tmp)));
runLog(['--close', '中止', '[停止] 測試結束'], tmp);

fs.rmSync(tmp, { recursive: true, force: true });
console.log(failures ? `\n${failures} 個失敗` : '\n全部通過');
process.exit(failures ? 1 : 0);
