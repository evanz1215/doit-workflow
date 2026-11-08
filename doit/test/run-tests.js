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
const STATE = '.doit';

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
const outsideFile = path.join(os.tmpdir(), 'doit-test-outside', 'helper.js');

const editEvent = (file) => ({ hook_event_name: 'PreToolUse', tool_name: 'Edit', cwd: tmp, tool_input: { file_path: file, old_string: 'a', new_string: 'b' } });
const bashEvent = (command) => ({ hook_event_name: 'PreToolUse', tool_name: 'Bash', cwd: tmp, tool_input: { command } });
const stopEvent = (active) => ({ hook_event_name: 'Stop', cwd: tmp, stop_hook_active: !!active });
const startEvent = () => ({ hook_event_name: 'SessionStart', cwd: tmp, source: 'startup' });
const taskPath = () => path.join(tmp, STATE, 'tasks', fs.readFileSync(path.join(tmp, STATE, 'ACTIVE'), 'utf8').trim());
const taskText = () => fs.readFileSync(taskPath(), 'utf8');

console.log('\n[1] 沒有任務時一律放行');
check('edit 放行', allowed(run(path.join(HOOKS, 'guard-edit.js'), editEvent(srcFile), tmp)));
check('commit 放行', allowed(run(path.join(HOOKS, 'guard-commit.js'), bashEvent('git commit -m "x"'), tmp)));
check('stop 放行', allowed(run(path.join(HOOKS, 'guard-stop.js'), stopEvent(false), tmp)));
const s0 = run(path.join(HOOKS, 'session-start.js'), startEvent(), tmp);
check('session-start 無輸出', s0.code === 0 && !s0.out.trim());

console.log('\n[2] log.js --help / --new');
const help = runLog(['--help'], tmp);
check('--help 成功且有用法', help.code === 0 && /用法/.test(help.out));
check('不認識的選項被拒', runLog(['--bogus'], tmp).code !== 0);
const n = runLog(['--new', 'Add Paging', '--set', '類型=feat', '--set', 'base=main', '--set', '下一步=探索'], tmp);
check('建立成功', n.code === 0, n.err);
check('ACTIVE 存在', fs.existsSync(path.join(tmp, STATE, 'ACTIVE')));
check('檔名含 slug', /-add-paging\.md$/.test(taskPath()), taskPath());
const excl = fs.readFileSync(path.join(tmp, '.git', 'info', 'exclude'), 'utf8');
check('.git/info/exclude 含 .doit/', excl.includes('.doit/'));
const st = git(['status', '--porcelain'], tmp).stdout;
check('git status 乾淨（任務檔被排除）', st.trim() === '', st);
check('--new 重複會失敗', runLog(['--new', 'Add Paging'], tmp).code !== 0);
check('任務檔以「## 紀錄」結尾且有建立行', /## 紀錄\n\[[\d\- :]+\] \[紀錄\] 任務建立\n$/.test(taskText()), JSON.stringify(taskText().slice(-80)));

console.log('\n[3] 探索中：擋改檔、擋 commit、擋 stop（下一步空）');
check('edit 專案檔被擋', denied(run(path.join(HOOKS, 'guard-edit.js'), editEvent(srcFile), tmp)));
check('edit 任務檔放行', allowed(run(path.join(HOOKS, 'guard-edit.js'), editEvent(taskPath()), tmp)));
check('edit 反斜線路徑也被擋', denied(run(path.join(HOOKS, 'guard-edit.js'), editEvent(srcFile.replace(/\//g, '\\')), tmp)));
check('edit 專案外檔案放行', allowed(run(path.join(HOOKS, 'guard-edit.js'), editEvent(outsideFile), tmp)));
check('wip commit 在未批准時被擋', denied(run(path.join(HOOKS, 'guard-commit.js'), bashEvent('git commit -m "wip: x"'), tmp)));
check('非 git 指令放行', allowed(run(path.join(HOOKS, 'guard-commit.js'), bashEvent('npm test'), tmp)));
check('git merge-base 放行（不是 merge）', allowed(run(path.join(HOOKS, 'guard-commit.js'), bashEvent('git merge-base --is-ancestor abc HEAD'), tmp)));
runLog(['--set', '下一步='], tmp);
const stopBlocked = run(path.join(HOOKS, 'guard-stop.js'), stopEvent(false), tmp);
check('下一步空 → stop 被擋', stopBlocked.json && stopBlocked.json.decision === 'block', stopBlocked.out);
check('stop_hook_active → 放行（防迴圈）', allowed(run(path.join(HOOKS, 'guard-stop.js'), stopEvent(true), tmp)));
check('block 訊息含 log.js 完整路徑', /node "[^"]*tools\/log\.js"/.test(stopBlocked.json ? stopBlocked.json.reason : ''), stopBlocked.out);
const transcriptTouched = path.join(tmp, 'transcript-touched.jsonl');
const transcriptClean = path.join(tmp, 'transcript-clean.jsonl');
fs.writeFileSync(transcriptTouched, '{"type":"assistant","text":"node tools/log.js --set x=y"}\n');
fs.writeFileSync(transcriptClean, '{"type":"assistant","text":"src 目錄下有 3 個檔案"}\n');
check('對話紀錄有碰 log.js → 仍擋', denied(run(path.join(HOOKS, 'guard-stop.js'), { ...stopEvent(false), transcript_path: transcriptTouched }, tmp)) || (run(path.join(HOOKS, 'guard-stop.js'), { ...stopEvent(false), transcript_path: transcriptTouched }, tmp).json || {}).decision === 'block');
check('純問答 session（紀錄沒有 log.js）→ 放行', allowed(run(path.join(HOOKS, 'guard-stop.js'), { ...stopEvent(false), transcript_path: transcriptClean }, tmp)));
check('transcript_path 指向不存在的檔 → 維持嚴格擋下', (run(path.join(HOOKS, 'guard-stop.js'), { ...stopEvent(false), transcript_path: path.join(tmp, 'nope.jsonl') }, tmp).json || {}).decision === 'block');
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
check('紀錄行有時間戳', /\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}\] \[完成\] 步驟 1/.test(taskText()));
runLog(['--set', '狀態=待批准'], tmp);
check('狀態變更自動留紀錄', /\[紀錄\] 狀態 → 待批准/.test(taskText()));
const lessons = runLog(['--lessons'], tmp);
check('--lessons 印出兩個標題', lessons.code === 0 && /專案教訓/.test(lessons.out) && /全域教訓/.test(lessons.out), lessons.out);
check('[證據 基準] 是合法標籤', runLog(['[證據 基準] npm test 無新失敗'], tmp).code === 0);
check('[證據 標準1 基準側] 編號後接說明是合法標籤', runLog(['[證據 標準1 基準側] 修改前 build 出 CS0649'], tmp).code === 0);
check('[證據 標準2（修改後）] 全形括號說明是合法標籤', runLog(['[證據 標準2（修改後）] 0 個 CS0649'], tmp).code === 0);
check('[證據 隨便] 仍被拒', runLog(['[證據 隨便] x'], tmp).code !== 0);
const lp = spawnSync(process.execPath, [LOG, '--lesson', 'project'], { cwd: tmp, encoding: 'utf8', input: '### P-001 測試教訓\n- 預防規則：x\n' });
check('--lesson project 寫入專案教訓檔', lp.status === 0 && /P-001 測試教訓/.test(fs.readFileSync(path.join(tmp, STATE, 'LESSONS.md'), 'utf8')), lp.stderr);
const lp2 = spawnSync(process.execPath, [LOG, '--lesson', 'project'], { cwd: tmp, encoding: 'utf8', input: '### P-002 第二條\n' });
const lessonsText = fs.readFileSync(path.join(tmp, STATE, 'LESSONS.md'), 'utf8');
check('第二條追加且只有一個標題', lp2.status === 0 && (lessonsText.match(/^# 專案教訓/gm) || []).length === 1 && /P-002/.test(lessonsText));
check('--lesson 沒有 stdin 內容被拒', spawnSync(process.execPath, [LOG, '--lesson', 'project'], { cwd: tmp, encoding: 'utf8', input: '' }).status !== 0);
check('--lesson 範圍不合法被拒', runLog(['--lesson', 'team'], tmp).code !== 0);
spawnSync(process.execPath, [LOG, '--lesson', 'project'], { cwd: tmp, encoding: 'utf8', input: '### P-003 可累加\n- 犯錯次數：1\n- 遇到次數：0\n- 首次：2026-01-01 ／ 最近：2026-01-01\n- 類型：流程\n' });
const b1 = runLog(['--lesson-bump', 'project', 'P-003'], tmp);
let lt = fs.readFileSync(path.join(tmp, STATE, 'LESSONS.md'), 'utf8');
check('--lesson-bump 犯錯次數 +1', b1.code === 0 && /### P-003 可累加\n- 犯錯次數：2\n- 遇到次數：0\n/.test(lt), b1.err + lt.slice(-200));
check('--lesson-bump 更新「最近」為今天', new RegExp(`首次：2026-01-01 ／ 最近：${new Date().getFullYear()}-\\d{2}-\\d{2}`).test(lt), lt.slice(-200));
const b2 = runLog(['--lesson-bump', 'project', 'P-003', '--hit'], tmp);
lt = fs.readFileSync(path.join(tmp, STATE, 'LESSONS.md'), 'utf8');
check('--lesson-bump --hit 遇到次數 +1、犯錯不變', b2.code === 0 && /- 犯錯次數：2\n- 遇到次數：1\n/.test(lt), lt.slice(-200));
check('--lesson-bump 其他條目不受影響', /### P-001 測試教訓\n- 預防規則：x\n/.test(lt));
check('--lesson-bump 不存在的編號被拒', runLog(['--lesson-bump', 'project', 'P-099'], tmp).code !== 0);
check('--lesson-bump 編號格式不合被拒', runLog(['--lesson-bump', 'project', 'abc'], tmp).code !== 0);
check('--lesson-bump 沒有次數行被拒', runLog(['--lesson-bump', 'project', 'P-002'], tmp).code !== 0);

console.log('\n[5] 紀錄插入位置：在「## 紀錄」小節內、計畫之前，不累積空行');
fs.appendFileSync(taskPath(), '\n## 計畫 v1\n\n### 做法\n改 a.js\n');
runLog(['[紀錄] 第一行'], tmp);
runLog(['[紀錄] 第二行'], tmp);
runLog(['[紀錄] 第三行'], tmp);
const t5 = taskText();
const logIdx = t5.indexOf('## 紀錄');
const planIdx = t5.indexOf('## 計畫 v1');
const l3 = t5.indexOf('[紀錄] 第三行');
check('紀錄行在計畫之前', logIdx < l3 && l3 < planIdx, `logIdx=${logIdx} l3=${l3} planIdx=${planIdx}`);
check('計畫小節仍在檔尾', /## 計畫 v1\n\n### 做法\n改 a\.js\n$/.test(t5), JSON.stringify(t5.slice(-60)));
check('紀錄行之間沒有空行', !/第一行\n\n/.test(t5) && !/第二行\n\n/.test(t5), JSON.stringify(t5.slice(l3 - 120, l3 + 40)));
check('紀錄與計畫之間剛好一個空行', /第三行\n\n## 計畫 v1/.test(t5));
check('沒有連續空行', !/\n\n\n/.test(t5));

console.log('\n[6] commit guard 去皮：訊息或紀錄文字裡的 push/merge/commit 不算');
check('log.js 紀錄文字含 merge 放行', allowed(run(path.join(HOOKS, 'guard-commit.js'), bashEvent('node log.js "[紀錄] 回報分支 $(git rev-parse --short HEAD) 由使用者 merge"'), tmp)));
check('log.js 紀錄文字含 commit 放行', allowed(run(path.join(HOOKS, 'guard-commit.js'), bashEvent('node log.js "[紀錄] 交付 commit 已完成"'), tmp)));
runLog(['--set', '狀態=已批准', '--set', '批准=v1「照計畫做」', '[批准 v1] 「照計畫做」'], tmp);
check('批准只留 agent 手寫那一行，不自動補 [紀錄] 批准 →', /\[批准 v1\] 「照計畫做」/.test(taskText()) && !/\[紀錄\] 批准 →/.test(taskText()));
check('wip 訊息含 push 放行', allowed(run(path.join(HOOKS, 'guard-commit.js'), bashEvent('git commit -m "wip: 步驟 3 完成，之後再 push"'), tmp)));
check('heredoc 內文含 merge 的 wip 放行', allowed(run(path.join(HOOKS, 'guard-commit.js'), bashEvent('git commit -F - <<\'EOF\'\nwip: 步驟 2\n\n之後 merge 到 main\nEOF\n'), tmp)));
check('真正的 git push 仍被擋', denied(run(path.join(HOOKS, 'guard-commit.js'), bashEvent('git push origin HEAD'), tmp)));
check('真正的 git merge 仍被擋', denied(run(path.join(HOOKS, 'guard-commit.js'), bashEvent('git merge feat/x'), tmp)));
check('&& 串接的 git push 仍被擋', denied(run(path.join(HOOKS, 'guard-commit.js'), bashEvent('git commit -m "wip: x" && git push'), tmp)));

console.log('\n[7] 已批准：放行改檔與 wip commit，擋交付 commit 與 push');
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

console.log('\n[8] 完成：全部放行');
runLog(['--close', '完成', '[紀錄] 門檻通過'], tmp);
check('交付 commit 放行', allowed(run(path.join(HOOKS, 'guard-commit.js'), bashEvent('git commit -m "feat: paging"'), tmp)));
check('--allow-empty 交付 commit 放行', allowed(run(path.join(HOOKS, 'guard-commit.js'), bashEvent('git commit --allow-empty -m "feat: paging"'), tmp)));
check('push 放行', allowed(run(path.join(HOOKS, 'guard-commit.js'), bashEvent('git push'), tmp)));
check('stop 放行', allowed(run(path.join(HOOKS, 'guard-stop.js'), stopEvent(false), tmp)));
const s2 = run(path.join(HOOKS, 'session-start.js'), startEvent(), tmp);
check('session-start 無提示', s2.code === 0 && !s2.out.trim());

console.log('\n[9] 無人看管低風險例外（v0.3 預留）');
runLog(['--new', 'auto-low', '--set', '等級=低', '--set', '無人看管=是', '--set', '下一步=x'], tmp);
check('探索中但 auto+低 → edit 放行', allowed(run(path.join(HOOKS, 'guard-edit.js'), editEvent(srcFile), tmp)));
runLog(['--set', '等級=中'], tmp);
check('auto+中 → edit 被擋', denied(run(path.join(HOOKS, 'guard-edit.js'), editEvent(srcFile), tmp)));
runLog(['--close', '中止', '[停止] 測試結束'], tmp);

fs.rmSync(tmp, { recursive: true, force: true });
console.log(failures ? `\n${failures} 個失敗` : '\n全部通過');
process.exit(failures ? 1 : 0);
