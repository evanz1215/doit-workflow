#!/usr/bin/env node
'use strict';
// PreToolUse (Bash|PowerShell)
// 硬規則 2：完成門檻未過，不得做交付 commit；只允許 wip: 前綴的檢查點 commit。
// 任務未完成時不得 git push / git merge / gh pr merge。
//
// 判斷 git 子指令時先把 heredoc 內文與引號字串去掉，避免 commit 訊息或
// log.js 的紀錄文字裡出現「push」「merge」「commit」就被誤擋。
// bash|sh|zsh -c "…"、pwsh|powershell -Command "…" 引號內的指令會另外抽出來照同樣規則判斷。

const lib = require('./lib.js');

const input = lib.readStdinJson();
const cmd = String((input.tool_input || {}).command || '');
if (!cmd) lib.allow();

// 找出每個 git 指令的子指令：git 之後第一個不是選項的字（-C、-c 會多吃一個參數）。
// 只比對子指令本身，分支名或參數裡的 push／merge／commit（例如 git switch -c fix/push-id）不算。
function gitCalls(s) {
  const calls = [];
  // 前面不能是字元、點、連字號（排除 .git、my-git）；後面不能接路徑或字元（排除 .git/config、github）
  for (const m of s.matchAll(/(?<![\w.-])git(?:\.exe)?(?![\w./-])([^|&;\n]*)/g)) {
    const toks = m[1].trim().split(/\s+/).filter(Boolean);
    let sub = '';
    for (let i = 0; i < toks.length; i++) {
      if (toks[i] === '-C' || toks[i] === '-c') { i++; continue; }
      if (toks[i].startsWith('-')) continue;
      sub = toks[i];
      break;
    }
    calls.push({ sub, index: m.index });
  }
  return calls;
}
// gh pr merge 等同 merge；gh pr view、gh pr create 不算。只看前兩個不是選項的字。
function hasGhPrMerge(s) {
  for (const m of s.matchAll(/(?<![\w.-])gh(?:\.exe)?(?![\w./-])([^|&;\n]*)/g)) {
    const words = m[1].trim().split(/\s+/).filter((t) => t && !t.startsWith('-'));
    if (words[0] === 'pr' && words[1] === 'merge') return true;
  }
  return false;
}

// bash -c "…"、pwsh -Command '…' 這類引號內的指令。在去皮後的指令裡找殼層與 -c 旗標
// （紀錄文字裡的同樣字樣已被去皮，不算），再回原始指令同一位置抽引號內容。
function shellInners(raw, bare) {
  const inners = [];
  for (const m of bare.matchAll(/(?<![\w.-])(?:bash|sh|zsh|pwsh|powershell)(?:\.exe)?(?![\w./-])(?:\s+-(?!c\s|command\s)[\w-]+)*\s+-(?:c|command)(?=\s)/gi)) {
    // 引號內容在去皮後是空白，所以 -c 後面的空白要回原始指令才跳得過
    const rest = raw.slice(m.index + m[0].length).trimStart();
    const dq = rest.match(/^"((?:[^"\\]|\\.)*)"/);
    const sq = rest.match(/^'([^']*)'/);
    if (dq) inners.push(dq[1].replace(/\\(["\\$`])/g, '$1'));
    else if (sq) inners.push(sq[1]);
  }
  return inners;
}

// 回傳這段指令（含殼層 -c 內的指令）有沒有 commit／push／merge，以及 commit 是否全部是 wip。
function inspect(raw) {
  const bare = lib.stripShellLiterals(raw);
  const calls = gitCalls(bare);
  const commits = calls.filter((c) => c.sub === 'commit');
  const r = {
    commit: commits.length > 0,
    push: calls.some((c) => c.sub === 'push'),
    merge: calls.some((c) => c.sub === 'merge') || hasGhPrMerge(bare),
    // 每個 commit 段的位置以這段指令自己為基準
    wip: commits.every((m, i) => segIsWip(raw.slice(m.index, commits[i + 1] ? commits[i + 1].index : undefined))),
  };
  for (const inner of shellInners(raw, bare)) {
    const x = inspect(inner);
    r.commit = r.commit || x.commit;
    r.push = r.push || x.push;
    r.merge = r.merge || x.merge;
    r.wip = r.wip && x.wip;
  }
  return r;
}

const found = inspect(cmd);
if (!found.commit && !found.push && !found.merge) lib.allow();

const cwd = input.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
const root = lib.findProjectRoot(cwd);
const task = lib.readActiveTask(root);
if (lib.isClosed(task)) lib.allow();

const status = task.fields['狀態'] || '';

if (found.push || found.merge) {
  lib.denyPreToolUse(
    `[doit] 任務 ${task.name} 狀態為「${status}」，尚未完成，不得 git push / merge 或 gh pr merge。完成門檻通過並把狀態改為「完成」後才可以。`
  );
}

// 檢查點 commit 的判定要看原始指令（wip: 在引號裡）：
// -m "wip: ..."、-m 'wip: ...'、或 heredoc 第一行 wip:
// 每個 git commit 各自切一段（位置取自去皮後的指令，訊息裡的「git commit」不算），
// 每段只看第一個訊息旗標（-m、-am、--message），後面再接 -m "wip: …" 不算。全部是 wip 才放行。
function segIsWip(seg) {
  const msg = seg.match(/\s(?:-[a-zA-Z]*m|--message)[\s=]*["']?\s*(\S*)/);
  const heredocWip = /<<-?\s*["']?\w+["']?[^\n]*\r?\n\s*wip:/i.test(seg);
  return msg ? /^wip:/i.test(msg[1]) || (msg[1].startsWith('$(') && heredocWip) : heredocWip;
}
if (found.wip) {
  if (lib.LOCKED_STATUSES.includes(status)) {
    lib.denyPreToolUse(`[doit] 計畫尚未批准（狀態「${status}」），不得 commit。`);
  }
  lib.allow();
}

lib.denyPreToolUse(
  `[doit] 任務 ${task.name} 狀態為「${status}」，完成門檻尚未通過，不得做交付 commit。` +
  `中途存檔請用 wip: 前綴（例如 git commit -m "wip: 步驟 2 完成"）；交付 commit 要等所有驗收標準有證據、審查無 blocker/major、狀態改為「完成」之後。`
);
