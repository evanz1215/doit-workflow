#!/usr/bin/env node
'use strict';
// SessionStart：有未完成任務時提示一行，讓 agent 知道可以 /doit:resume。

const lib = require('./lib.js');

const input = lib.readStdinJson();
const cwd = input.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
const root = lib.findProjectRoot(cwd);
const task = lib.readActiveTask(root);
if (lib.isClosed(task)) lib.allow();

const f = task.fields;
lib.sessionContext(
  `[doit] 這個專案有未完成的工作流任務：${task.name}。` +
  `狀態「${f['狀態'] || '?'}」、等級「${f['等級'] || '?'}」、分支「${f['分支'] || '?'}」、` +
  `下一步「${f['下一步'] || '（未填）'}」。使用者輸入 /doit:resume 時依任務檔接續，/doit:status 看狀態。`
);
