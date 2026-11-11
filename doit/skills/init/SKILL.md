---
name: init
description: 設定 doit 工作流在這個專案的行為：完成後要不要 commit、要不要開 PR。使用者輸入 /doit:init 時使用。
argument-hint: [commit=on|off] [pr=on|off]
disable-model-invocation: true
---

# doit：專案設定

回報一律繁體中文。參數：$ARGUMENTS

設定存在專案的 `.doit/config.json`，不進 git。沒有設定檔時用預設值，所以不跑這個指令也能用 `/doit:go`。

| 設定 | 預設 | on | off |
|---|---|---|---|
| `commit` | on | 中風險以上每步做 `wip:` 檢查點 commit，完成後做交付 commit | 不做任何 commit，變更留在工作目錄，完成時列出改了哪些檔案 |
| `pr` | off | 完成後 push 分支並開 PR（需要 remote 與 `gh`；需要 `commit=on`） | 只回報分支名稱，push 與 merge 由使用者自己做 |

## 做法

1. 必須在 git repo 裡。不是就告知並停止。
2. **有參數**（例如 `commit=off`、`pr=on`）：直接執行

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/tools/log.js" --config <參數原樣>
   ```

   失敗時（格式不符、`pr=on` 但 `commit=off`）照錯誤訊息告訴使用者，不要自己改參數重試。
3. **沒有參數**：先執行 `node "${CLAUDE_PLUGIN_ROOT}/tools/log.js" --config` 印出目前設定，再用上面的表格向使用者說明每一項目前是什麼、改了會怎樣，問要改哪些。使用者回答後照第 2 步寫入；使用者說不改就結束。
4. 回報：

```
⚙️ doit 設定

- **commit**：<on／off>（<一句話：這代表什麼>）
- **pr**：<on／off>（<一句話>）
- **檔案**：.doit/config.json
- **生效**：下一個 /doit:go 任務開始時讀取；進行中的任務在接續（/doit:resume）時重新讀取
```

`pr=on` 時另外檢查一次 `git remote -v` 有沒有 remote，沒有就提醒使用者開 PR 會失敗、完成時只會回報分支。
