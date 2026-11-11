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

console.log('\n[2a] log.js --config');
const cfgPath = path.join(tmp, STATE, 'config.json');
const c0 = runLog(['--config'], tmp);
check('沒有設定檔時印出預設值且不建檔', c0.code === 0 && /commit: on（預設）/.test(c0.out) && /pr: off（預設）/.test(c0.out) && !fs.existsSync(cfgPath), c0.out + c0.err);
const c1 = runLog(['--config', 'commit=off'], tmp);
check('commit=off 寫入設定檔', c1.code === 0 && JSON.parse(fs.readFileSync(cfgPath, 'utf8')).commit === 'off', c1.err);
check('commit=off 時 pr=on 被拒且設定不變', runLog(['--config', 'pr=on'], tmp).code !== 0 && JSON.parse(fs.readFileSync(cfgPath, 'utf8')).pr === 'off');
check('同一次 commit=on pr=on 可以', runLog(['--config', 'commit=on', 'pr=on'], tmp).code === 0 && /pr: on/.test(runLog(['--config'], tmp).out));
check('未知的鍵被拒', runLog(['--config', 'push=on'], tmp).code !== 0);
check('值不是 on/off 被拒', runLog(['--config', 'commit=yes'], tmp).code !== 0);
check('原型上的名稱（toString）不是合法的鍵，且沒寫進設定檔', runLog(['--config', 'toString=on'], tmp).code !== 0 && !Object.hasOwn(JSON.parse(fs.readFileSync(cfgPath, 'utf8')), 'toString'));
fs.writeFileSync(cfgPath, '{"toString":"on"}');
check('設定檔裡有原型上的名稱時報錯', runLog(['--config'], tmp).code !== 0);
fs.writeFileSync(cfgPath, '{"commit":"on","pr":"on"}');
check('設定檔被 git 排除', git(['status', '--porcelain'], tmp).stdout.trim() === '');
fs.writeFileSync(cfgPath, '{"commit":"maybe"}');
check('設定檔內容不合法時報錯', runLog(['--config'], tmp).code !== 0);
fs.rmSync(cfgPath);
const n = runLog(['--new', 'Add Paging', '--set', '類型=feat', '--set', 'base=main', '--set', '下一步=探索'], tmp);
check('建立成功', n.code === 0, n.err);
check('ACTIVE 存在', fs.existsSync(path.join(tmp, STATE, 'ACTIVE')));
check('檔名含 slug', /-add-paging\.md$/.test(taskPath()), taskPath());
const excl = fs.readFileSync(path.join(tmp, '.git', 'info', 'exclude'), 'utf8');
check('.git/info/exclude 含 .doit/', excl.includes('.doit/'));
const st = git(['status', '--porcelain'], tmp).stdout;
check('git status 乾淨（任務檔被排除）', st.trim() === '', st);
check('--new 重複會失敗', runLog(['--new', 'Add Paging'], tmp).code !== 0);
const activeBefore = fs.readFileSync(path.join(tmp, STATE, 'ACTIVE'), 'utf8');
const np = runLog(['--new-plan', 'Big Feature'], tmp);
const planFiles = fs.existsSync(path.join(tmp, STATE, 'plans')) ? fs.readdirSync(path.join(tmp, STATE, 'plans')) : [];
check('--new-plan 建立計畫檔骨架', np.code === 0 && planFiles.length === 1 && /-big-feature\.md$/.test(planFiles[0]) && /## 任務清單/.test(fs.readFileSync(path.join(tmp, STATE, 'plans', planFiles[0] || 'x'), 'utf8')), np.err);
check('--new-plan 不動 ACTIVE，計畫檔被 git 排除', fs.readFileSync(path.join(tmp, STATE, 'ACTIVE'), 'utf8') === activeBefore && git(['status', '--porcelain'], tmp).stdout.trim() === '');
check('--new-plan 重複會失敗', runLog(['--new-plan', 'Big Feature'], tmp).code !== 0);
check('--new-plan 沒給 slug 被拒', runLog(['--new-plan'], tmp).code !== 0);
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
check('session-start 提示未完成任務並指向 /doit:resume', s1.json && /未完成/.test(s1.json.hookSpecificOutput.additionalContext) && /\/doit:resume/.test(s1.json.hookSpecificOutput.additionalContext), s1.out);

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
check('[審查 plan-critic @v1] 是合法標籤', runLog(['[審查 plan-critic @v1] 結論：可送批准'], tmp).code === 0);
check('[審查 verifier @abc1234] 是合法標籤', runLog(['[審查 verifier @abc1234] 結論：通過', '[審查 verifier] [major] 邊界輸入 null 靜默吞錯 → 已修正'], tmp).code === 0);
check('[審查] 沒有審查者名稱被拒', runLog(['[審查] 結論：可合併'], tmp).code !== 0);
check('--help 列出 plan-critic 與 verifier 標籤', /plan-critic/.test(help.out) && /verifier/.test(help.out));

console.log('\n[4b] agents：三個審查類 subagent 都存在且只讀');
for (const [agent, mustHave] of [['reviewer', '輸出格式'], ['plan-critic', '需求覆蓋'], ['verifier', '邊界輸入']]) {
  const p = path.join(PLUGIN, 'agents', `${agent}.md`);
  const exists = fs.existsSync(p);
  check(`agents/${agent}.md 存在`, exists);
  if (!exists) continue;
  const text = fs.readFileSync(p, 'utf8');
  const fm = text.match(/^---\n([\s\S]*?)\n---/);
  const nameLine = fm && fm[1].match(/^name:\s*(.+)$/m);
  const toolsLine = fm && fm[1].match(/^tools:\s*(.+)$/m);
  check(`${agent} frontmatter name 一致`, nameLine && nameLine[1].trim() === agent);
  check(`${agent} 工具不含 Edit/Write`, toolsLine && !/\b(Edit|Write|MultiEdit|NotebookEdit)\b/.test(toolsLine[1]));
  check(`${agent} 內容含「${mustHave}」`, text.includes(mustHave));
}
const implText = fs.readFileSync(path.join(PLUGIN, 'agents', 'implementer.md'), 'utf8');
const implFm = (implText.match(/^---\n([\s\S]*?)\n---/) || [])[1] || '';
check('implementer frontmatter name 一致', /^name:\s*implementer\s*$/m.test(implFm));
check('implementer 工具含 Edit、Write、Bash', ['Edit', 'Write', 'Bash'].every((t) => new RegExp(`^tools:.*\\b${t}\\b`, 'm').test(implFm)));
check('implementer 寫明不 commit、不碰 .doit/、有輸出格式', /不做任何 `git commit`/.test(implText) && /不讀寫 `\.doit\/`/.test(implText) && implText.includes('輸出格式'));
const skillText = fs.readFileSync(path.join(PLUGIN, 'skills', 'go', 'SKILL.md'), 'utf8');
for (const sk of ['go', 'ask', 'plan', 'init', 'resume', 'status', 'abort']) {
  const p = path.join(PLUGIN, 'skills', sk, 'SKILL.md');
  const t = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
  check(`skills/${sk}/SKILL.md 存在且 name 一致`, new RegExp(`^---\\n[\\s\\S]*?^name:\\s*${sk}\\s*$`, 'm').test(t));
  if (sk !== 'go') check(`${sk} 只能由使用者觸發`, /^disable-model-invocation:\s*true\s*$/m.test(t));
}
const STAGE_EMOJI = ['🧰', '🔍', '❓', '📝', '✋', '🔨', '🧪', '👀', '📦', '🪞'];
check('SKILL.md 有「階段回報」模板與十個階段的 emoji', /## 階段回報/.test(skillText) && STAGE_EMOJI.every((e) => skillText.includes(e)));
STAGE_EMOJI.forEach((e, n) => {
  const sec = (skillText.split(new RegExp(`^## 階段 ${n}：`, 'm'))[1] || '').split(/^## /m)[0];
  check(`階段 ${n} 段落結尾有回報指示`, /^- \*\*回報\*\*：/m.test(sec) && (sec.includes(`${e} Step ${n}`) || n === 5));
});
check('SKILL.md 階段 0 讀設定，階段 8 依 commit／pr 設定交付', /log\.js" --config/.test(skillText) && /\*\*`commit=off`\*\*/.test(skillText) && /`pr=off`（預設）/.test(skillText) && !/有 CI 設定（`\.github/.test(skillText));
check('回報要輸出給使用者、headless 也要、先回報再動下一階段', /不能只寫在思考裡/.test(skillText) && /headless（`claude -p`）也一樣要回報/.test(skillText) && /\*\*先回報，再動下一個階段\*\*/.test(skillText));
check('go 的回報模板有十個階段的進度清單與符號說明', /進度 \{已完成的階段數\}／10：/.test(skillText) && /\*\*進度清單\*\*/.test(skillText) && ['前置', '探索', '釐清', '計畫', '批准', '實作', '驗證', '審查', '完成', '檢討'].every((s) => new RegExp(`[✅▶⬜] ${s}`, 'u').test(skillText)));
check('Step 5 回報要直接寫驗證結果', /不要寫「見下一份回報」/.test(skillText));
check('跳過的階段仍用五欄模板，完成門檻歸 Step 8', /不要改用自由條列/.test(skillText) && /完成門檻檢查是 Step 8 的事/.test(skillText));
check('交付回報每條驗收標準一行', /\*\*每條驗收標準一行\*\*/.test(skillText));
const reviewText = fs.readFileSync(path.join(PLUGIN, 'skills', 'go', 'references', 'review.md'), 'utf8');
check('審查意見分級規則：blocker 必須修、major 可不採納但要列進回報', /## 意見分級怎麼處理/.test(reviewText) && /\*\*必須修\*\*，沒有例外/.test(reviewText) && /\*\*預設要修\*\*/.test(reviewText) && !/blocker \/ major 必須/.test(reviewText + skillText));
check('步驟數規則涵蓋低風險 1 步', /低風險的單檔改動可以只有 1 步/.test(skillText) && !/2–5 步/.test(skillText));
check('檢討規則涵蓋高風險（SKILL 與 retro 一致）', /中風險與高風險每次做/.test(skillText) && /中風險與高風險：每次任務完成或中止後/.test(fs.readFileSync(path.join(PLUGIN, 'skills', 'go', 'references', 'retro.md'), 'utf8')));
check('舊的「回報格式」小節已移除', !/^## 回報格式/m.test(skillText));
for (const agent of ['plan-critic', 'implementer', 'verifier', 'reviewer']) {
  check(`${agent} 規定 Bash 一次一條指令`, /Bash 一次呼叫只跑一條指令/.test(fs.readFileSync(path.join(PLUGIN, 'agents', `${agent}.md`), 'utf8')));
}
check('review.md 規定重審開新的前景呼叫、不用 SendMessage', /不用 SendMessage/.test(fs.readFileSync(path.join(PLUGIN, 'skills', 'go', 'references', 'review.md'), 'utf8')));
const askText = fs.readFileSync(path.join(PLUGIN, 'skills', 'ask', 'SKILL.md'), 'utf8');
check('ask 規定只讀、不建任務、有回答格式', /不改任何檔案/.test(askText) && /不建立 doit 任務/.test(askText) && /### 💬 doit:ask/.test(askText));
check('ask 固定欄位只有依據與不確定的地方，其餘適用時才出現', /\*\*只在適用時出現\*\*/.test(askText) && /- \*\*依據\*\*/.test(askText) && /- \*\*不確定的地方\*\*/.test(askText) && /順帶發現/.test(askText));
const planText = fs.readFileSync(path.join(PLUGIN, 'skills', 'plan', 'SKILL.md'), 'utf8');
check('plan 規定只規劃不實作、用 --new-plan 建檔、指令帶計畫檔路徑', /不改專案檔案/.test(planText) && /不建立 doit 任務/.test(planText) && /--new-plan/.test(planText) && /\/doit:go 依 \.doit\/plans\//.test(planText));
check('plan 的回報模板有七個階段的進度清單', /進度 \{已完成的階段數\}／7：/.test(planText) && /\*\*進度清單\*\*/.test(planText));
check('go 認得計畫檔：階段 0 讀它、完成時更新任務狀態', /指令提到計畫檔/.test(skillText) && /任務來自計畫檔時/.test(skillText));
const planFmt = fs.readFileSync(path.join(PLUGIN, 'skills', 'go', 'references', 'plan-format.md'), 'utf8');
check('計畫格式有「需要你決定」與假設查證狀態', /### 需要你決定/.test(planFmt) && /已查證：/.test(planFmt) && /未查證：/.test(planFmt));
check('plan-critic 會查證假設', /\*\*假設查證\*\*/.test(fs.readFileSync(path.join(PLUGIN, 'agents', 'plan-critic.md'), 'utf8')));
check('init 沒參數時用 AskUserQuestion 讓使用者點選', /AskUserQuestion/.test(fs.readFileSync(path.join(PLUGIN, 'skills', 'init', 'SKILL.md'), 'utf8')));
check('resume 指向 go 的主流程', fs.readFileSync(path.join(PLUGIN, 'skills', 'resume', 'SKILL.md'), 'utf8').includes('skills/go/SKILL.md'));
check('沒有殘留的 /doit:doit', !/\/doit:doit/.test(skillText + fs.readFileSync(path.join(HOOKS, 'session-start.js'), 'utf8')));
check('SKILL.md 階段 5 派 doit:implementer，不再說尚未實作', /doit:implementer/.test(skillText) && !/implementer」?尚未實作/.test(skillText));
check('SKILL.md 提到 doit:plan-critic 與 doit:verifier', /doit:plan-critic/.test(skillText) && /doit:verifier/.test(skillText));
check('SKILL.md 不再說高風險關卡尚未實作', !/高風險專屬關卡（plan-critic/.test(skillText));
for (const ref of ['tiering', 'plan-format', 'implement', 'review', 'retro', 'ui-verify']) {
  check(`references/${ref}.md 存在且 SKILL.md 有引用`, fs.existsSync(path.join(PLUGIN, 'skills', 'go', 'references', `${ref}.md`)) && skillText.includes(`references/${ref}.md`));
}

console.log('\n[4c] --ref：Read 被權限擋下時仍讀得到參考檔');
const refList = runLog(['--ref'], tmp);
check('--ref 不給名稱會列出可用名稱', refList.code === 0 && ['tiering', 'plan-format', 'implement', 'review', 'ui-verify', 'retro', 'go', 'status', 'abort'].every((n) => refList.out.includes(n)), refList.out + refList.err);
for (const ref of ['tiering', 'plan-format', 'implement', 'review', 'retro', 'ui-verify']) {
  const r = runLog(['--ref', ref], tmp);
  check(`--ref ${ref} 印出參考檔全文`, r.code === 0 && r.out === fs.readFileSync(path.join(PLUGIN, 'skills', 'go', 'references', `${ref}.md`), 'utf8'), r.err);
}
const refGo = runLog(['--ref', 'go'], tmp);
check('--ref go 印出主流程 SKILL.md 全文', refGo.code === 0 && refGo.out === skillText, refGo.err);
const refBad = runLog(['--ref', '../../README'], tmp);
check('--ref 不接受表外的名稱（路徑穿越被拒，錯誤訊息列出可用名稱）', refBad.code !== 0 && /可用名稱/.test(refBad.err) && !refBad.out);
const noRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'doit-noref-'));
const refNoRepo = runLog(['--ref', 'review'], noRepo);
check('--ref 不需要在 git repo 裡', refNoRepo.code === 0 && /## 完成門檻/.test(refNoRepo.out), refNoRepo.err);
fs.rmSync(noRepo, { recursive: true, force: true });
check('--help 有 --ref 的說明', /--ref \[名稱\]/.test(help.out));
check('SKILL.md 規定參考檔讀不到先用 --ref，再不行就停下', /log\.js" --ref <名稱>/.test(skillText) && /兩種方式都讀不到就停下/.test(skillText) && /不得憑印象/.test(skillText));
check('resume 與 plan 也有 --ref 的退路', /--ref go/.test(fs.readFileSync(path.join(PLUGIN, 'skills', 'resume', 'SKILL.md'), 'utf8')) && /--ref tiering/.test(planText));

console.log('\n[4d] 審查獨立性：prompt 不給任務檔路徑、審查 agent 不讀 .doit');
for (const agent of ['plan-critic', 'verifier', 'reviewer']) {
  const t = fs.readFileSync(path.join(PLUGIN, 'agents', `${agent}.md`), 'utf8');
  check(`${agent} 規定不讀 .doit/，缺內容時回報「prompt 缺」`, /\*\*不讀 `\.doit\/` 下的任何檔案\*\*/.test(t) && /prompt 缺：/.test(t));
}
check('review.md 規定審查 prompt 貼內容、不給任務檔路徑', /不給任務檔路徑/.test(reviewText) && /貼內容，不是給路徑/.test(reviewText) && !/<任務檔裡 ## 計畫 vN 的全文/.test(reviewText));
check('review.md 重審時貼修改後的計畫全文', /修改後的計畫全文/.test(reviewText) && !/附修改後的那幾節全文/.test(reviewText));
check('SKILL.md 階段 3 與階段 7 都寫明內容貼進 prompt', /貼進 prompt/.test(skillText) && /三種審查的 prompt 都把內容貼進去，不給任務檔路徑/.test(skillText));

console.log('\n[4e] verifier 通過但有 major、已定的決定、高風險審查修正');
check('review.md 有 verifier「通過但有 major」的重跑規則', /結論「通過」但有要修的 major/.test(reviewText) && /重送 verifier/.test(reviewText) && /只動測試檔/.test(reviewText));
check('SKILL.md 階段 7 提到通過但有 major 的重送', /結論「通過」但有要修的 major/.test(skillText));
const implRef = fs.readFileSync(path.join(PLUGIN, 'skills', 'go', 'references', 'implement.md'), 'utf8');
check('verifier 與 reviewer 的 prompt 模板都有「已定的決定」', (reviewText.match(/^## 已定的決定$/gm) || []).length === 2);
check('implementer 的 prompt 模板有「已定的決定」', /^## 已定的決定$/m.test(implRef));
for (const agent of ['verifier', 'reviewer', 'implementer']) {
  check(`${agent} 的收件清單有「已定的決定」`, /^- 已定的決定/m.test(fs.readFileSync(path.join(PLUGIN, 'agents', `${agent}.md`), 'utf8')));
}
check('verifier 會核對已定的決定', /假設與已定的決定核對/.test(fs.readFileSync(path.join(PLUGIN, 'agents', 'verifier.md'), 'utf8')));
check('SKILL.md 階段 4 記下已定的決定、處理改選另一個選擇', /\[紀錄\] 已定的決定：/.test(skillText) && /使用者改選「另一個選擇」/.test(skillText));
const fixSec = (implRef.split(/^## 審查後的修正/m)[1] || '').split(/^## /m)[0];
check('implement.md 有「審查後的修正」一節：派新的 implementer、不做 wip commit', /派一個新的 implementer，主流程不自己改/.test(fixSec) && /不做 wip commit/.test(fixSec) && /失敗計數另起/.test(fixSec));
check('SKILL.md 與 review.md 都指向「審查後的修正」', /高風險的審查修正也派新的 implementer/.test(skillText) && /`implement\.md`「審查後的修正」/.test(reviewText));
check('implement.md 的每步回報改用階段回報格式', !/用 3 行/.test(implRef) && /依 SKILL\.md「階段回報」的格式回報這一步/.test(implRef));

console.log('\n[4f] analyze-log.js 統計審查獨立性');
const fakeLog = path.join(os.tmpdir(), `doit-analyze-${process.pid}.jsonl`);
const asst = (content, parent) => JSON.stringify({ type: 'assistant', session_id: 's1', parent_tool_use_id: parent || null, message: { content } });
fs.writeFileSync(fakeLog, [
  asst([{ type: 'tool_use', id: 'A1', name: 'Agent', input: { subagent_type: 'doit:plan-critic', prompt: '計畫全文在 C:\\p\\.doit\\tasks\\x.md，請自己讀' } }]),
  asst([{ type: 'tool_use', id: 'S1', name: 'Read', input: { file_path: 'C:\\p\\.doit\\tasks\\x.md' } }], 'A1'),
  asst([{ type: 'tool_use', id: 'S2', name: 'Read', input: { file_path: 'C:\\scratch\\doit-sandbox\\src\\a.js' } }], 'A1'),
  asst([{ type: 'tool_use', id: 'A2', name: 'Agent', input: { subagent_type: 'doit:verifier', prompt: '## 驗收標準\n| 1 | … |' } }]),
  asst([{ type: 'tool_use', id: 'S3', name: 'Bash', input: { command: 'npm test' } }], 'A2'),
  asst([{ type: 'tool_use', id: 'A3', name: 'Agent', input: { subagent_type: 'doit:implementer', prompt: '不寫 `.doit/tasks` 底下的檔案' } }]),
].join('\n') + '\n');
const an = spawnSync(process.execPath, [path.join(PLUGIN, 'test', 'analyze-log.js'), fakeLog], { encoding: 'utf8' });
check('審查 prompt 指向任務檔會被算到（implementer 的 prompt 不算）', an.status === 0 && /審查 prompt 指向任務檔：1 次（doit:plan-critic）/.test(an.stdout), an.stdout + an.stderr);
check('subagent 讀 .doit 會被算到（路徑裡的 doit-sandbox 不算）', /subagent 碰到 \.doit：1 次（doit:plan-critic:Read）/.test(an.stdout), an.stdout);
fs.rmSync(fakeLog, { force: true });

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
check('第二個 -m 才是 wip 仍被擋', denied(run(path.join(HOOKS, 'guard-commit.js'), bashEvent('git commit -m "feat: paging" -m "wip: 假的"'), tmp)));
check('wip 之後再串一個交付 commit 被擋', denied(run(path.join(HOOKS, 'guard-commit.js'), bashEvent('git commit -m "wip: a" && git commit -m "feat: b"'), tmp)));
check('兩個 wip commit 串接放行', allowed(run(path.join(HOOKS, 'guard-commit.js'), bashEvent('git commit -m "wip: a" && git commit -m "wip: b"'), tmp)));
check('wip 訊息裡有 git commit 字樣放行', allowed(run(path.join(HOOKS, 'guard-commit.js'), bashEvent('git commit -m "wip: 修 git commit hook"'), tmp)));
check('wip -am 放行', allowed(run(path.join(HOOKS, 'guard-commit.js'), bashEvent('git commit -am "wip: 步驟 1"'), tmp)));
check('wip --message= 放行', allowed(run(path.join(HOOKS, 'guard-commit.js'), bashEvent('git commit --message="wip: 步驟 1"'), tmp)));
check('--set 值含換行被拒', runLog(['--set', '下一步=a\n狀態: 完成'], tmp).code !== 0 && /狀態: 已批准/.test(taskText()));
check('有進行中任務時 --new 被拒', runLog(['--new', 'another'], tmp).code !== 0 && /add-paging/.test(taskPath()));
for (const c of ['git switch -c fix/push-id-padding', 'git checkout -b feat/merge-helper', 'git checkout -b fix/commit-msg', 'git log --grep push', 'git branch -d old-merge', 'cat .git/config push']) {
  check(`子指令不是 push／merge／commit 就放行：${c}`, allowed(run(path.join(HOOKS, 'guard-commit.js'), bashEvent(c), tmp)));
}
for (const c of ['git -C . push', 'git -c user.name=x push origin HEAD', '/usr/bin/git push', 'git.exe merge feat/x', 'git --no-pager commit -m "feat: x"']) {
  check(`帶全域選項或路徑的 git 仍被擋：${c}`, denied(run(path.join(HOOKS, 'guard-commit.js'), bashEvent(c), tmp)));
}
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
