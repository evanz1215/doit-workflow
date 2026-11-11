---
name: abort
description: 中止 doit 工作流目前的任務，狀態改為「中止」，不動分支與程式碼。使用者輸入 /doit:abort 時使用。
argument-hint: [中止原因]
disable-model-invocation: true
---

<!-- 只能由使用者觸發：中止任務會解除 hooks 的限制 -->

# doit：中止目前任務

回報一律繁體中文。原因：$ARGUMENTS

1. 執行 `node "${CLAUDE_PLUGIN_ROOT}/tools/log.js" --show`。
   - 回「無進行中任務」，或狀態已是「完成」「中止」：告訴使用者沒有可中止的任務。結束。
2. 向使用者確認一次：列出任務檔名、狀態、分支，說明中止後 hooks 不再限制改檔與 commit，分支、commit 與工作目錄的修改都會原樣保留。問「確定要中止嗎？」。
   - 使用者執行指令時已附原因，不代表已確認，仍要問。
3. 使用者明確同意後執行：

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/tools/log.js" --close 中止 "[停止] 使用者中止：<原因；沒給就寫「未說明」>"
   ```

   原因含 `$` 時用單引號包整個紀錄行。
4. 回報已中止，並列出保留下來的東西：分支名稱、wip commit 數（`git log --oneline <起始SHA>..HEAD`）、工作目錄未 commit 的檔案（`git status --porcelain`）。不要替使用者刪分支、還原檔案或 reset。
