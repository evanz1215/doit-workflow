'use strict';
// 解析 claude -p --output-format stream-json 的紀錄
// 用法：node doit/test/analyze-log.js <run.jsonl>
// 列出每個工具呼叫、subagent 呼叫（[sub]）、hook 擋下（HOOK DENY）、工具錯誤與最終結果，用來稽核沙盒測試是否照 SKILL.md 走。
const fs = require('fs');
const file = process.argv[2];
const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);

let sessionId = null;
const tools = new Map(); // id -> {name, summary}
const events = [];
let result = null;

function short(s, n = 160) {
  s = String(s).replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n) + '…' : s;
}

for (const line of lines) {
  let ev;
  try { ev = JSON.parse(line); } catch { continue; }
  if (ev.session_id && !sessionId) sessionId = ev.session_id;
  if (ev.type === 'assistant' && ev.message && Array.isArray(ev.message.content)) {
    const sub = ev.parent_tool_use_id ? '  [sub] ' : '';
    for (const c of ev.message.content) {
      if (c.type === 'tool_use') {
        const i = c.input || {};
        const summary = i.command || i.file_path || i.pattern || i.description || i.skill || i.subagent_type || JSON.stringify(i);
        tools.set(c.id, { name: c.name, summary });
        events.push(`${sub}TOOL ${c.name}: ${short(summary)}`);
      } else if (c.type === 'text' && c.text.trim()) {
        events.push(`${sub}TEXT: ${short(c.text, 240)}`);
      }
    }
  }
  if (ev.type === 'user' && ev.message && Array.isArray(ev.message.content)) {
    for (const c of ev.message.content) {
      if (c.type === 'tool_result') {
        const text = Array.isArray(c.content) ? c.content.map((x) => x.text || '').join(' ') : String(c.content || '');
        const t = tools.get(c.tool_use_id) || { name: '?' };
        if (/\[doit\]/.test(text)) events.push(`   >> HOOK DENY on ${t.name}: ${short(text, 220)}`);
        else if (c.is_error) events.push(`   >> ERROR on ${t.name}: ${short(text, 220)}`);
      }
    }
  }
  if (ev.type === 'system' && ev.subtype && /hook/i.test(ev.subtype)) {
    events.push(`SYSTEM ${ev.subtype}: ${short(JSON.stringify(ev), 220)}`);
  }
  if (ev.type === 'result') result = ev;
}

console.log(`session_id: ${sessionId}`);
console.log(`events: ${events.length}`);
console.log('----');
for (const e of events) console.log(e);
console.log('----');
if (result) {
  console.log(`result.subtype: ${result.subtype}  turns: ${result.num_turns}  cost_usd: ${result.total_cost_usd}  duration_s: ${Math.round((result.duration_ms || 0) / 1000)}`);
  console.log(`final text: ${short(result.result || '', 1500)}`);
}
