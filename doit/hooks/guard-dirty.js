#!/usr/bin/env node
'use strict';
// PostToolUse (Bash|PowerShell)
// 硬規則 1 的補強：guard-edit 只管 Edit/Write，用 Bash 寫檔（sed -i、> 重導向、腳本）擋不到。
// 計畫未批准、實作還沒開始（分支尚未建立）時，工作目錄不該有任何專案檔變更；
// 指令跑完後若 git status 不乾淨，把 block 訊息送回模型：確定是自己造成的才記錯並還原已追蹤檔，
// 分不出來源或可能是使用者改的就不記錯、不還原，列出變更問使用者。
// 實作開始後又回到鎖定狀態（例如待使用者）刻意不檢查：那時的變更是實作產物。
// 例外：無人看管模式且等級為低（同 guard-edit）。

const path = require('path');
const { spawnSync } = require('child_process');
const lib = require('./lib.js');

const input = lib.readStdinJson();
const cwd = input.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
const root = lib.findProjectRoot(cwd);
const task = lib.readActiveTask(root);
if (lib.isClosed(task)) lib.allow();

const status = task.fields['狀態'] || '';
if (!lib.LOCKED_STATUSES.includes(status) || task.fields['分支'] !== '尚未建立') lib.allow();
if (task.fields['無人看管'] === '是' && task.fields['等級'] === '低') lib.allow();

const r = spawnSync('git', ['--no-optional-locks', '-c', 'core.quotepath=false', 'status', '--porcelain'], { cwd: root, encoding: 'utf8' });
if (r.error || r.status !== 0) lib.allow();

const dirty = r.stdout.split(/\r?\n/).filter((l) => {
  if (!l.trim()) return false;
  const p = l.slice(3).replace(/^"/, '');
  return !(p === lib.WF_DIR || p.startsWith(lib.WF_DIR + '/'));
});
if (!dirty.length) lib.allow();

const MAX = 20;
const listed = dirty.slice(0, MAX).join('\n') + (dirty.length > MAX ? `\n…（另有 ${dirty.length - MAX} 行）` : '');
const logJs = lib.normalize(path.join(process.env.CLAUDE_PLUGIN_ROOT || path.resolve(__dirname, '..'), 'tools', 'log.js'));
lib.blockStop(
  `[doit] 任務 ${task.name} 狀態為「${status}」，計畫還沒批准、實作還沒開始，工作目錄不該有專案檔變更，但 git status 有：\n${listed}\n` +
  `確定是這個 session 剛跑的指令造成的：先用 node "${logJs}" "[錯誤 來源：agent 分類：流程] <哪個指令改了什麼>" 記一行，` +
  `只還原這個 session 自己用工具寫出的已追蹤檔案（例如 git checkout -- <檔>）；未追蹤的檔案列出來問使用者，不要刪。` +
  `分不出是誰改的、或可能是使用者自己改的：不記錯誤、不還原，列出變更停下問使用者。`
);
