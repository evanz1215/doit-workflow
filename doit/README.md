# doit：依風險分級的開發工作流（Claude Code plugin）

把一個開發指令走完：探索 → 釐清 → 計畫落檔 → 使用者批准 → 實作 → 驗證 → 獨立審查 → commit → 檢討。出錯代價決定關卡數量：低風險走輕流程，中風險加計畫批准、檢查點 commit 與獨立 reviewer，高風險再加 plan-critic、verifier 與瀏覽器驗證（v0.2 起）。

三條硬規則由 hooks 強制，不靠 agent 自覺：計畫未批准不得改專案檔；完成門檻未過不得做交付 commit、push、merge；離開前必須寫明下一步。

## 使用

```
/doit:doit <開發指令>     新任務
/doit:doit                接續未完成任務
/doit:doit status         看狀態
/doit:doit abort          中止
```

任務狀態放在目標專案的 `.doit/`，由 `tools/log.js` 寫入，不進 git。

## 需求

- Node.js（hooks 與 log.js 用 node 執行）
- 目標專案必須是 git repo

## 測試

```
node test/run-tests.js
```

設計文件與市面調查見 repo 根目錄的 `workflow-design.md` 與 `market-workflows-comparison.md`。
