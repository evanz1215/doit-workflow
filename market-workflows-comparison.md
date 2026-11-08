# 市面上 AI Agent 開發工作流整理與比較

> 整理日期：2026-11-08。目的：為設計自己的 AI Agent 開發工作流提供參考。
> 來源多為官方文件、GitHub 專案與社群評測，基準數據請視為「方向性」而非定論。

## 0. 先看全貌：三大流派

| 流派 | 核心想法 | 代表 |
|---|---|---|
| **A. 規格驅動（Spec-Driven Development, SDD）** | 先把需求、設計、任務寫成檔案，agent 照檔案做，人在每個關卡批准 | GitHub Spec Kit、AWS Kiro、OpenSpec、BMAD |
| **B. 方法論／技能包（Methodology / Skills）** | 不換工具，在既有 coding agent 上疊一層「怎麼做事」的流程與角色 | Anthropic 官方 Explore-Plan-Code-Commit、obra/superpowers、gstack、Agent OS、PRP、Task Master |
| **C. 自主迴圈／背景代理（Autonomous loop / Background agent）** | 人只給目標與驗收條件，agent 無人看管地跑到完成 | Ralph Wiggum loop、Copilot coding agent、Codex Cloud、Cursor background agents、Devin |

三者不互斥：常見的組合是 A 或 B 產出計畫與任務，再丟給 C 執行。

---

## 1. 各工作流詳解

### 1.1 Anthropic 官方：Explore → Plan → Code → Commit

**流程**
1. **Explore**：Plan mode 只讀不改，讀相關檔案、理解現況
2. **Plan**：要求 agent 產出詳細實作計畫，人審過
3. **Code**：照計畫實作，邊做邊對照計畫驗證
4. **Commit**：寫 commit message、開 PR
- 搭配 `CLAUDE.md` 放穩定的專案知識、subagent 隔離 context 做探索

**優點**
- 最輕量，沒有額外工具與檔案格式，一天就能上手
- 官方背書，和 Claude Code 的 plan mode、subagent、hooks 直接對應
- 強調 context 管理（context 填滿會降低品質），是其他流程常忽略的點

**缺點**
- 「計畫」只存在對話中，沒有持久化，中斷後難接續
- 沒有風險分級、沒有獨立審查者、沒有驗收標準格式，全靠使用者自律
- 多任務、多人協作時缺乏可追溯的產物

**適合**：單人、單次、中小型任務；當其他流程的「底層骨架」。

---

### 1.2 GitHub Spec Kit

**流程**：`/speckit.constitution` → `/speckit.specify` → `/speckit.clarify` → `/speckit.plan` → `/speckit.analyze` → `/speckit.tasks` → `/speckit.implement`
- constitution：專案不可違反的原則
- specify：功能規格（what / why，不談技術）
- plan：技術方案
- tasks：可執行的任務清單
- clarify / analyze 是品質關卡，正式工作建議開啟

**優點**
- Agent 無關，支援約 30 種 coding agent，安裝進既有工具即可
- 關卡清楚、產物可追溯（規格 → 計畫 → 任務一路對應）
- 社群活躍，有 plan review gate、verify-tasks（抓「幽靈完成」：任務勾了但沒程式碼）等擴充；官方 PR 也在討論加 `/speckit.critique`

**缺點**
- **只有慣例、沒有強制**：不驗證、不擋，agent 可以直接忽略
- 產出「一片 markdown 海」，小任務像「多了幾步的 waterfall」
- 規格與程式碼容易脫節，維護模式留給各團隊自己決定
- 官方也承認 context 填滿後 agent 會漏做任務或幻覺，建議切小

**適合**：0→1 新功能、跨技術棧團隊、需要可追溯文件的專案。

---

### 1.3 AWS Kiro（spec-first IDE）

**流程**：Requirements → Design → Tasks → Execute，每階段人工批准後才進下一階段
- Requirements 用 **EARS** 語法寫驗收標準（「WHEN… THE SYSTEM SHALL…」）
- Design 從 codebase 與已批准需求生成（資料流、介面、schema、API）
- Tasks 依相依性排序、連回需求，獨立任務分「waves」可平行
- **Agent Hooks**：檔案事件觸發背景 agent（存檔自動補測試、更新文件）
- **Steering files**：跨功能的持久專案約束

**優點**
- 關卡是**真的擋住**（IDE 層面），不像 Spec Kit 只是慣例
- EARS 讓驗收標準格式統一、不含糊
- Hooks 把「存檔後自動做 X」變成一等公民
- 第三方評測中正確率與成本都表現不錯，規格最精簡

**缺點**
- **綁 IDE**：必須用 Kiro，不能疊在 Claude Code／Cursor 上
- 計量收費（免費 50 credits，付費 $20–$200/月，數字以官網為準）
- EARS 標準本身不可執行，仍需另外寫測試
- 對 AWS 外的生態整合較弱

**適合**：已在 AWS 生態、想要「整合式」體驗、接受換 IDE 的團隊。

---

### 1.4 OpenSpec

**流程**：Proposal → Apply → Archive
- Proposal：產出任務清單 + **規格差異（spec delta）**，而不是整份新規格
- Apply：實作已批准的任務
- Archive：完成的變更移進日期資料夾，規格合併回主規格

**優點**
- 專為 **brownfield（既有系統改動）** 設計，一個改動跨多份規格時比 Spec Kit 順
- 比 Spec Kit 輕，產物少
- Node.js 工具，agent 無關

**缺點**
- 關卡與驗證比 Spec Kit 更弱
- 0→1 新專案沒有優勢
- 社群與文件規模較小

**適合**：對既有 codebase 做中小型改動、想保留規格但不想每次重寫整份。

---

### 1.5 BMAD-METHOD（Breakthrough Method for Agile AI-Driven Development）

**流程**：角色化 agent 接力：Analyst → PM（PRD）→ Architect（架構文件）→ Scrum Master（切 epic / story）→ Dev（實作 story）→ QA（審查）
- 每個角色有獨立 persona 與 prompt，產物是 PRD、架構文件、epics、stories
- v6 有 50+ 指令與子流程

**優點**
- 最完整的「虛擬團隊」，大型功能的文件品質最好
- MIT 免費，agent 無關
- 角色分離天然帶來「寫的人不審自己」的效果

**缺點**
- **最重**：批評者估約兩個月才能熟練（Spec Kit 一兩天）
- Token 成本最高、產出規格文字最多
- 小專案「還沒開始寫程式動能就沒了」，被批評為退回 waterfall 的 big design up front
- 仍依賴 agent 自覺：有案例是 story 標完成但功能是壞的

**適合**：大型、高風險、需要 PRD 與架構文件給利害關係人看的專案。

---

### 1.6 obra/superpowers（Jesse Vincent）

**流程**：`/brainstorm` → `/write-plan` → `/execute-plan`
- brainstorm：對話式釐清，寫設計規格到 `docs/superpowers/specs/`
- write-plan：切成任務關卡式計畫到 `docs/superpowers/plans/`
- execute-plan：**subagent-driven development**，每個任務派一個全新 subagent 執行，再做**兩階段審查**：先規格符合度、再程式碼品質
- 內建 TDD skill（red-green-refactor）、systematic debugging、verification-before-completion 等技能，依情境自動啟用

**優點**
- 技能是「觸發式」而非「流程式」，自然融入對話，不需要記指令
- 每任務新 subagent，context 乾淨、不互相污染
- 兩階段審查把「做對事」和「做得好」分開
- 規格與計畫落地成檔案，可接續

**缺點**
- 綁 Claude Code 的 skills/plugin 機制
- 自動觸發的技能有時會在不需要時啟動（例如小修改也走 TDD）
- 沒有風險分級，所有任務走一樣深度
- 專案演進快，第三方文件常過時

**適合**：Claude Code 使用者、想要「有紀律但不官僚」的單人／小團隊。

---

### 1.7 gstack（Garry Tan）：你機器上已安裝

**流程**：`/plan-ceo-review` → `/plan-design-review` → `/plan-eng-review` → 實作 → `/review` → `/qa` → `/ship`
- CEO review：先問「該不該做、做多大」（Expansion / Selective / Hold / Reduction 四種模式）
- Eng review：鎖定架構、資料流、邊界情況、測試計畫
- `/autoplan`：三個 review 自動串起來，只把「品味決策」浮上來問人
- `/qa` 用真實瀏覽器點過產品找 bug；`/ship` 同步 base、跑測試、處理 review、推 PR
- 下游接力：eng review 寫的測試計畫給 `/qa` 用；`/review` 找到的 bug 由 `/ship` 驗證已修

**優點**
- 唯一把「**產品判斷**」（該不該做）放進流程的；其他都假設需求已定
- 關卡之間有明確交接物（測試計畫、review 結果）
- `/qa` 用瀏覽器實測，不只跑單元測試
- 有 `/retro`、`/learn`、`/health` 等維運面技能

**缺點**
- 技能數量多（60+），學習與選擇成本高
- 強烈反映作者個人風格（founder-mode），不一定適合受雇工程師的情境
- 綁 Claude Code；部分技能依賴自家瀏覽器工具
- 版本迭代快，技能清單常變

**適合**：獨立開發者／創業者，產品決策與工程決策是同一個人。

---

### 1.8 Agent OS（Builder Methods）

**流程**：Discover standards → Inject standards → Build → Refine standards
- 重點不是「這次任務的規格」，而是**團隊慣例的持久化**：從 codebase 挖出慣例寫成 standards，每次任務注入相關的 standards，做完再修正

**優點**
- 解決「agent 每次都偏離團隊慣例」這個最常見的痛點
- 和任何 SDD 工具可疊加
- 多 LLM 相容

**缺點**
- 本身不是完整的開發流程，需要搭配別的工具
- standards 的維護是人工負擔，久了會過期

**適合**：團隊有明確 coding conventions、想降低 agent 風格漂移。

---

### 1.9 Context Engineering / PRP（Cole Medin）

**流程**：`INITIAL.md`（功能需求）→ `/generate-prp`（產出 Product Requirements Prompt：需求 + 相關程式碼範例 + 文件連結 + 驗證指令）→ `/execute-prp`
- 核心主張：agent 失敗多半是**缺 context**，不是模型不夠聰明；PRP 把實作前所有需要的 context 一次打包

**優點**
- 一份 PRP 自帶驗證指令，agent 做完能自己跑檢查
- 強調「給範例」（examples 資料夾），比純文字規格有效
- 結構簡單，兩個指令

**缺點**
- 單次性：PRP 做完就過期，沒有規格演進的概念
- 沒有審查、沒有角色分離
- 偏個人工作流，團隊協作面弱

**適合**：單人、單功能、需要大量外部文件 context 的任務（整合第三方 API 等）。

---

### 1.10 Task Master AI（claude-task-master）

**流程**：寫 PRD → `parse-prd` 產出 `tasks.json` → `next` 取下一個任務 → `expand` 拆子任務 → 實作 → `set-status done`
- 以 MCP server 形式接進 Cursor / Claude Code / Windsurf
- 任務有相依關係、優先級、複雜度分析

**優點**
- 任務狀態機清楚，天然支援中斷接續與多 session
- 工具無關（MCP）
- 複雜度分析幫忙決定哪些任務要再拆

**缺點**
- 只管「任務清單」，規格、設計、審查都在流程外
- PRD 品質決定一切，PRD 寫爛任務就爛
- 任務拆分有時過細，變成管理負擔

**適合**：想要一個獨立的「任務追蹤層」搭配其他流程的人。

---

### 1.11 Ralph Wiggum loop（Geoffrey Huntley，2025-07）

**流程**：
```bash
while true; do
  cat PROMPT.md | claude -p --dangerously-skip-permissions
done
```
- 每輪**全新 context** 重讀同一份 prompt，進度全靠檔案與 git 保存
- 完成條件寫在 prompt 裡（測試全過、build 成功），達到就跳出
- 社群實作（ralph-orchestrator 等）加了花費上限、斷路器、git 檢查點

**優點**
- 無人看管可跑數小時，適合「明確、可機器驗證」的大量工作
- 用 fresh context 繞過 context 填滿的問題
- 概念極簡

**缺點**
- **token 燃燒快**，沒上限會失控
- Agent 會「宣稱成功」；沒有客觀驗證（測試）就是在自欺
- 需要大量前期規劃（prompt 要寫對）
- 必須在沙箱跑（`--dangerously-skip-permissions`）
- 「有效直到無效」：失敗模式多且已被充分記錄

**適合**：已有完整規格與測試、可全自動驗證的 migration、大量重複性改寫。

---

### 1.12 雲端背景代理：Copilot coding agent / Codex Cloud / Cursor background agents / Devin

**流程**：指派 issue 或下任務 → 雲端沙箱 clone repo → agent 自主實作 → 開 PR → 人 review → 修正迴圈

| 工具 | 定位 | 特色 |
|---|---|---|
| GitHub Copilot coding agent | GitHub 原生 | issue → PR 在 Actions 內完成，整合最深；適合範圍明確任務，不適合深度重構 |
| OpenAI Codex Cloud | 多平面 | 託管沙箱、`@codex review` 審 PR；GitHub 整合比 Copilot 淺 |
| Cursor background agents | 編輯器優先 | 隔離 VM，可從 Slack / GitHub / 手機觸發 |
| Devin（含 Devin Desktop，前 Windsurf） | 最自主 | 像委派給 junior engineer；任務要緊、review 門檻要高 |

**優點**
- 平行化：多個任務同時跑，人只做 review
- 不佔本機與個人注意力
- 與 issue / PR 流程原生整合，團隊採用阻力小

**缺點**
- 黑箱程度高，中途難介入
- 2026 上半年多家改計量收費，實際成本高於標價
- 深度重構、需要大量來回釐清的任務表現差
- 需要 CI 與測試夠完整，否則 PR 品質無法把關

**適合**：backlog 裡範圍明確的中小任務；團隊已有健全 CI。

---

## 2. 橫向比較表

| 工作流 | 流派 | 綁定工具 | 重量 | 人工關卡 | 獨立審查 | 風險分級 | 持久狀態 | Brownfield 友善 | 學習曲線 |
|---|---|---|---|---|---|---|---|---|---|
| Anthropic EPCC | B | Claude Code | 極輕 | 計畫 | ✗ | ✗ | ✗ | ○ | 1 天 |
| Spec Kit | A | 無（30+ agents） | 中 | 多關卡（慣例） | ✗（社群擴充） | ✗ | ✓ 檔案 | △ | 1–2 天 |
| Kiro | A | Kiro IDE | 中 | 多關卡（強制） | ✗ | ✗ | ✓ 檔案 | ○ | 數天 |
| OpenSpec | A | 無 | 輕 | proposal | ✗ | ✗ | ✓ 檔案 | ✓ | 1 天 |
| BMAD | A | 無 | 極重 | 每角色 | ✓（QA 角色） | ✗ | ✓ 檔案 | △ | 數週 |
| superpowers | B | Claude Code | 中 | brainstorm / plan | ✓ 兩階段 subagent | ✗ | ✓ 檔案 | ○ | 1–2 天 |
| gstack | B | Claude Code | 中重 | CEO / eng review | ✓ `/review` | ✗ | △ | ○ | 數天 |
| Agent OS | B | 無 | 輕 | ✗ | ✗ | ✗ | ✓ standards | ✓ | 1 天 |
| PRP | B | 無 | 輕 | PRP 審閱 | ✗ | ✗ | △ 單次 | ○ | 半天 |
| Task Master | B | MCP | 輕 | PRD | ✗ | △ 複雜度 | ✓ tasks.json | ○ | 1 天 |
| Ralph loop | C | 任意 CLI | 極輕 | ✗（事前） | ✗ | ✗ | ✓ git | ○ | 半天 |
| 雲端背景代理 | C | 各家平台 | 不適用 | PR review | △ 自家 review bot | ✗ | ✓ PR | ○ | 半天 |

（✓ 有、△ 部分、○ 中性、✗ 無。「風險分級」指**依出錯代價調整審查深度**，市面工具幾乎都沒有。）

---

## 3. 跨流程共同模式（可直接借用的設計原則）

1. **先讀再寫、先計畫再動手**：所有流程都有 explore / plan 階段，差別只在產物是否落地成檔案。
2. **計畫落地成檔案**：Spec Kit、Kiro、superpowers、Task Master 都把計畫寫進 repo，才能中斷接續與審查。
3. **人工關卡放在「改方向代價最高」的地方**：需求 → 設計之間、設計 → 實作之間。
4. **寫的人不審自己**：BMAD 的 QA 角色、superpowers 的 fresh subagent 兩階段審查、gstack 的 `/review`，都在隔離審查者的 context。
5. **Fresh context 對抗品質衰退**：Ralph 每輪重開、superpowers 每任務新 subagent、官方建議 subagent 做探索。
6. **客觀驗證取代 agent 自述**：測試通過、build 成功、瀏覽器實測；Spec Kit 社群的 verify-tasks 專門抓「勾了但沒做」。
7. **持久化專案知識與教訓**：CLAUDE.md、Kiro steering、Agent OS standards、gstack `/learn`。
8. **完成定義寫清楚**：Ralph 的跳出條件、Kiro 的 EARS、gstack 的測試計畫交接。

## 4. 跨流程共同失敗模式

| 失敗模式 | 誰最常中 | 解法 |
|---|---|---|
| 幽靈完成（任務標完成、程式碼沒做或壞的） | BMAD、Spec Kit、Ralph | 獨立驗證者實跑；完成門檻綁測試 |
| 文件過重、動能流失 | BMAD、Spec Kit 用在小任務 | 風險分級：小任務走輕流程 |
| 規格與程式碼脫節 | 所有 SDD | OpenSpec 式 delta；或規格只活到 PR 合併 |
| Context 填滿後漏做、幻覺 | 長任務的所有流程 | 切小任務；subagent；fresh context |
| 流程只是慣例、agent 直接跳過 | Spec Kit、PRP、EPCC | 硬規則 + hooks 強制（Kiro 式） |
| Token 失控 | Ralph、BMAD、背景代理 | 花費上限、斷路器 |
| 需求釐清不足就開做 | Ralph、背景代理 | 阻擋型疑問先問（superpowers brainstorm、gstack CEO review） |

---

## 5. 設計新工作流時要決定的事

從上面 12 種流程歸納，一個新工作流大致要在以下 10 個軸上做選擇。每個軸列出市面上的兩端做法與代價，供設計時勾選。

| # | 設計軸 | 一端 | 另一端 | 市面上的教訓 |
|---|---|---|---|---|
| 1 | **流程重量** | 固定一套深度（Spec Kit、BMAD） | 依任務風險或大小調整深度 | 固定深度是「小任務動能流失」的主因；市面上幾乎沒人做分級，是空白地帶 |
| 2 | **計畫落地** | 只在對話裡（EPCC） | 寫成 repo 內檔案（Kiro、superpowers、Task Master） | 不落地就無法中斷接續、無法給審查者看 |
| 3 | **關卡強制力** | 慣例，靠 prompt 遵守（Spec Kit、PRP） | 機制強制，hooks 或 IDE 擋住（Kiro） | 慣例型關卡 agent 會跳過；強制型要付出靈活度 |
| 4 | **人工關卡位置** | 每階段都批准（BMAD、Kiro） | 只在改方向代價最高處批准（需求→設計、設計→實作） | 關卡太多人會疲乏、開始無腦按過 |
| 5 | **需求釐清** | 假設需求已定，直接做（Ralph、背景代理） | 先挑戰「該不該做、做多大」（gstack CEO review、superpowers brainstorm） | 需求錯了後面全白做；個人專案尤其需要這一關 |
| 6 | **驗收標準格式** | 自由文字 | 固定語法（Kiro EARS）或可執行測試 | 固定語法讓驗證可機器化，但 EARS 本身仍不可執行 |
| 7 | **實作的 context 策略** | 主 context 一路做到底 | 每任務 fresh subagent（superpowers）或每輪重開（Ralph） | 長任務在主 context 必然衰退、漏做 |
| 8 | **審查者** | 自己審（EPCC、PRP） | 隔離 context 的獨立審查者，可再分「符合規格」與「程式品質」兩階段 | 寫的人審自己抓不到幽靈完成 |
| 9 | **完成定義** | agent 自述完成 | 客觀證據：測試過、build 過、瀏覽器實測（gstack `/qa`） | 所有流派最常見的失敗就是「說做完了但沒做」 |
| 10 | **知識累積** | 每次任務獨立、不留東西 | 持久化慣例與教訓（CLAUDE.md、Agent OS standards、gstack `/learn`）；規格 delta 歸檔（OpenSpec） | 不累積就每次重犯同樣錯、每次重新偏離慣例 |

其他要先決定的邊界條件：

- **綁定工具**：只跑 Claude Code（可用 skills、subagent、hooks 全套）還是要 agent 無關（只能用檔案與慣例）。
- **使用情境**：單人還是團隊、greenfield 還是 brownfield。OpenSpec 與 Spec Kit 的差異證明這兩者需要的產物不同。
- **自主程度**：要不要有「批准後無人看管跑到完成」的模式。有的話必須搭配花費上限與客觀完成條件。
- **成本**：BMAD 與 Ralph 證明 token 可以失控；重流程要有理由。

---

## 6. 來源

### 規格驅動總覽與評測
- [6 Best Spec-Driven Development Tools for AI Coding in 2026 — Augment Code](https://www.augmentcode.com/tools/best-spec-driven-development-tools)
- [7 Spec-Driven Development Tools: Spec Kit, Kiro, OpenSpec, Tessl — SSOJet](https://ssojet.com/blog/best-spec-driven-development-tools)
- [Spec-Driven Development in 2026 — DEV Community](https://dev.to/krlz/spec-driven-development-in-2026-what-it-is-the-tooling-and-how-teams-actually-use-it-2fk2)
- [Spec-Driven Development Benchmark 2026 — uvik](https://uvik.net/blog/spec-driven-development-benchmark/)
- [OpenSpec vs Spec Kit vs BMAD — aicodingpatterns](https://aicodingpatterns.com/en/patterns/openspec-vs-spec-kit-vs-bmad/)
- [Spec-Driven Development Tools: Spec Kit vs OpenSpec vs Kiro — TestMu AI](https://www.testmuai.com/blog/spec-driven-development-tools/)
- [Reviving Brownfield Projects with AI: Spec Kit, OpenSpec, BMAD — Medium](https://medium.com/@mathivananmani/reviving-brownfield-projects-with-ai-a-comparative-look-at-github-spec-kit-openspec-and-bmad-a7bc5116dd9a)

### Anthropic / Claude Code
- [Claude Code Best Practices — 官方文件](https://code.claude.com/docs/en/best-practices.md)
- [10 Claude Code Best Practices for Agentic Coding — OpenHands](https://www.openhands.dev/blog/claude-code-best-practices-agentic-coding)
- [The Claude Code Agentic Loop — Medium](https://medium.com/@roanmonteiro/the-claude-code-agentic-loop-a-complete-practitioners-guide-0b338647a3aa)

### Spec Kit
- [GitHub Spec Kit: How It Works and When to Use It — CodeMySpec](https://codemyspec.com/blog/github-spec-kit-guide)
- [GitHub Spec Kit Production Guide — Wavect](https://wavect.io/blog/github-spec-kit-production-guide.md)
- [spec-kit PR #2044: /speckit.critique 提案](https://github.com/github/spec-kit/pull/2044)
- [Microsoft Learn: Examine GitHub Spec Kit commands](https://learn.microsoft.com/en-us/training/modules/spec-driven-development-github-spec-kit-greenfield-intro/8-examine-github-spec-kit-commands-results?pivots=text)

### Kiro
- [Kiro Specs Explained: EARS, Spec Mode, and the Trade-offs — CodeMySpec](https://codemyspec.com/blog/kiro-specs-explained)
- [Beyond Vibe Coding: Spec-Driven Development in Kiro — AWS Builder Center](https://builder.aws.com/content/3Kp7g07c1mV5R3E5KxPFolK36nT/beyond-vibe-coding-building-reliable-applications-with-spec-driven-development-in-kiro)
- [The Lean Kiro Setup — HackerNoon](https://hackernoon.com/the-lean-kiro-setup-that-keeps-ai-coding-tasks-focused)

### OpenSpec
- [OpenSpec Commands — Maestro docs](https://docs.runmaestro.ai/openspec-commands)
- [OpenSpec Guide — Jama Software](https://www.jamasoftware.com/blog/openspec-guide/)
- [OpenSpec Quickstart — glukhov.org](https://glukhov.org/ai-devtools/openspec/)

### BMAD
- [Limitations of BMAD Method](https://asantos2000.github.io/blog/post-3/)
- [BMAD Method AI Development — Augment Code](https://www.augmentcode.com/guides/bmad-method-ai-development)
- [BMAD Method Disappointment — guillim](https://guillim.github.io/ai/development/2026/02/08/bmad-method-disappointment.html)
- [Tech Lead Journal #255: Spec-Driven Development with BMad Method](https://techleadjournal.dev/episodes/255/)

### superpowers / gstack / Agent OS / PRP
- [obra/superpowers wiki](https://moltchat-agent-commons.onrender.com/wiki/obra%2Fsuperpowers_(skills_framework_and_dev_methodology))
- [Superpowers Quickstart — glukhov.org](https://glukhov.org/ai-devtools/superpowers/)
- [Claude Superpowers Skill Guide — mcp.directory](https://mcp.directory/blog/claude-superpowers-skill-guide)
- [garrytan/gstack — GitHub](https://github.com/garrytan/gstack)
- [gstack: Garry Tan's Production Claude Code Skills Toolkit](https://codex.danielvaughan.com/2026/03/30/gstack-garry-tan-production-skills-toolkit/)
- [Agent OS Workflow — Builder Methods](https://buildermethods.com/agent-os/workflow)
- [Spec Kit, BMAD and Agent OS — Medium](https://medium.com/@tim_wang/spec-kit-bmad-and-agent-os-e8536f6bf8a4)
- [TypeScript Context Engineering Template（改自 Cole Medin 原版）](https://github.com/DwayneSamuels/typescript-context-engineering-template)

### Ralph Wiggum loop
- [The Ralph Wiggum Loop, From First Principles — DreamHost](https://www.dreamhost.com/blog/ralph-wiggum/)
- [Ralph Wiggum: The Dumbest Smart Way to Run Coding Agents](https://sidbharath.com/blog/ralph-wiggum-claude-code/)
- [The Ralph Wiggum Method Explained — GitNation](https://gitnation.com/contents/the-ralph-wiggum-method-explained)
- [Wigging Out: Controlled Autonomous Loops — Zencoder](https://zencoder.ai/blog/wigging-out-controlled-autonomous-loops-in-zenflow)

### 雲端背景代理
- [Top 7 GitHub Coding Agents in 2026 — Incredibuild](https://www.incredibuild.com/blog/best-github-coding-agents-2026)
- [Best AI Coding Agents in 2026 — Encore](https://encore.dev/articles/best-ai-coding-agents)
- [Best AI Coding Agents in 2026: Harness, Cost, and Accuracy — Firecrawl](https://www.firecrawl.dev/blog/best-ai-coding-agents)
- [AI Coding Tools Pricing Comparison 2026 — Developers Digest](https://www.developersdigest.tech/blog/ai-coding-tools-pricing-2026)
