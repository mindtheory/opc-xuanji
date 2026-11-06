 **OPC-玄机 · 技术选型与系统架构**

**前置约束**：数据库 = PostgreSQL，向量库 = pgvector。不引入独立向量数据库、独立消息队列、独立编排引擎。

---

## 一、运行时与插件装配层

### 1.1 Node.js 版本基线

**要求 Node.js ≥ 24.9。** 近期变更已明确“必须使用 Node.js 24.9 或更高版本，不再支持 Node.js 22”，CI 覆盖 24.9、最新 24 与 26。Profile 的 `package.json` 写入 `"engines": { "node": ">=24.9" }`，Onboarding 预检脚本显式检查 `process.version`。

### 1.2 DSH Profile / Bundle 装配

沿用 DSH 原生 Profile → Bundle → patch 三层叠加，按主体类型生成 Profile：

| Profile       | 包含员工插件                             | 适用主体   |
| :------------ | :--------------------------------------- | :--------- |
| `opc-service` | 财税、法务、行政、战略、项目、情报、客户、WBS（外宣可选） | 纯服务型   |
| `opc-trade`   | 上 + 货栈 + WBS（外宣可选）              | 有实物销售 |
| `opc-full`    | 全量（车务按 1.3 规则决定是否独立；含 WBS、外宣） | 混合型     |

Web 形态（`dsh web`）负责老板交互与看板，Headless 形态负责夜间任务与 Workflow 引擎常驻，两者共享同一 PostgreSQL。

**v2.10 装配补充**：新增 `opc_web` 表现层插件，随 Profile 启用，注册左栏入口“OPC公司管理”与右侧面板。`opc_web` 不直接访问数据库或员工插件，统一经 `opc_hub` 的 Web API 与 `WebHostAdapter` 适配 DSH 实际插槽；Headless 负责计划任务、驾驶舱读模型刷新与简报生成。


## 二、数据层：PostgreSQL + pgvector

### 2.1 向量维度锁定与变更 Runbook（P0 闭合：cutover 原子性）

pgvector 的 HNSW 索引**无法在 `ALTER COLUMN TYPE` 后存活**，且旧向量无法跨维度 cast（会报 `expected <NEW_DIMS> dimensions, not <OLD_DIMS>`）；HNSW 最高支持 2000 维，超过则只能走精确扫描。因此维度变更不是“升级时自动跑”，而是计划内的 expand/contract 迁移。

v2.8 已采用 expand/contract 四步，但**未定义 cutover 的原子性**。本版明确：

**cutover 必须在单事务内完成**。公开的 online embedding migration 实践把 cutover 描述为 “brief lock”（子秒级），步骤为：停止应用 → drop 旧索引 → 重命名列 → 重命名索引 → retype 共享缓存表 → 提交 → 以新配置重启应用。这些动作如果不在同一个事务中，中途失败会产生“新旧列并存但查询指向不明”的中间态。

**修订后的 cutover 规则**：

1. cutover 的 DDL 全部在 **一个 `BEGIN…COMMIT`** 中执行：`DROP INDEX`（旧索引）、`ALTER COLUMN … RENAME`、`ALTER INDEX … RENAME`、`embedding_cache` 的 retype；
2. cutover 前设置 `lock_timeout`，超时即**整体回滚**，保留旧列可读，不产生部分切换；
3. **cutover 事务失败时，应用仍指向旧列**，无需回滚应用配置，仅需修复失败原因后重试 cutover；
4. cutover 成功后，应用以新 `EMBEDDING_DIM` / `EMBEDDING_MODEL` 重启，启动守卫拒绝连接维度不匹配的配置。

**完整的 expand/contract 生命周期**（与公开实践对齐）：

| 阶段         | 动作                                             | 应用是否在线   |
| :----------- | :----------------------------------------------- | :------------- |
| Prepare      | 新增 `embedding_new VECTOR(N_new)` 列            | 在线（读旧列） |
| Backfill     | 用新模型填充新列，可中断、可重入（只填 NULL 行） | 在线           |
| Build index  | `CREATE INDEX CONCURRENTLY` 在新列上建 HNSW      | 在线           |
| Status       | 校验剩余未填充行 = 0、索引就绪                   | 在线           |
| **Cut over** | **单事务内完成 drop/rename/retype**              | **brief lock** |
| Finalize     | 删除旧列与旧索引，更新配置                       | 在线           |

若 N_new > 2000，跳过 HNSW，保留精确扫描并在看板标注“向量检索降级为精确扫描”。变更操作写入审计，记录旧/新 `model_id`、`dimension`、backfill 行数、cutover 时间与事务结果。

### 2.2 HNSW 参数基线

| 参数                   | 基线值         | 调整条件                                                     |
| :--------------------- | :------------- | :----------------------------------------------------------- |
| `m`                    | 16             | 默认；10 万级以上且召回不足时调至 24                         |
| `ef_construction`      | 64             | 默认；必须 ≥ 2×m；构建时间可接受时上调至 100–128             |
| `hnsw.ef_search`       | 40（会话默认） | 按场景动态设置：记忆/案例用 40；合同风险等高精度场景 `SET LOCAL hnsw.ef_search = 80`。**PgBouncer transaction 模式不支持跨语句 `SET`，动态设置必须在事务内用 `SET LOCAL`，或走直连 PG 通道** |
| `shared_buffers`       | 总内存 25%     | 启用本地嵌入模型时按实测预算下调（见 4.1）                   |
| `effective_cache_size` | 总内存 75%     | 与 `shared_buffers` 配合                                     |

**索引选型**：HNSW 优先（性能与对变化数据的鲁棒性优于 IVFFlat）；一人公司向量规模通常在万级以内，内存开销可控。

### 2.3 ORM 与迁移：Drizzle 单向采用

DSH 生态的 `session-persistence-rdb` 确已通过 drizzle 实现 `PersistenceBackend<number>`，复用上游 `PersistenceCoordinator` 与契约测试套件，支持 SQLite / PostgreSQL 后端切换。OPC-玄机沿用 Drizzle，并写入硬约束：

1. 所有迁移通过 `drizzle-kit generate` 产出，**不手动编辑自动生成的迁移文件**；
2. Drizzle 迁移器按 `__drizzle_migrations` 中的时间戳决定是否应用，历史迁移文件必须全部保留，**不可清理**；
3. 审计归档的 `schema_version` 迁移脚本与业务 schema 迁移**共用同一迁移链**；
4. 迁移目录纳入版本管理，作为归档可迁移性的基础。

### 2.4 连接池：PgBouncer 事务模式

PG 侧 `max_connections = 100 × CPU 核心数`；应用侧目标 `3–5 连接/核`进入数据库；PgBouncer `pool_mode = transaction`。

**4C 机器具体配置**：

```ini
[pgbouncer]
pool_mode = transaction
listen_port = 6432
max_client_conn = 200
default_pool_size = 20          ; 4C × 5 = 20
min_pool_size = 2               ; P2 修正：夜间低峰不维持 5 个空闲连接
reserve_pool_size = 3
reserve_pool_timeout = 3
server_idle_timeout = 600
```

**已知限制**：transaction 模式不支持跨语句 `SET`、临时表、advisory lock、`LISTEN/NOTIFY`。需要这些能力的查询走直连 PG 的专用通道，或事务内用 `SET LOCAL`。

### 2.5 Redis 边界

**v1 不部署 Redis。** 关键写操作（财税、法务、库存）直接落 PostgreSQL，以幂等键保障一致性。引入触发条件：夜间任务派发出现可观测的延迟或重复执行；引入后只承载**可重放信号**与轻量会话缓存，财税/法务写操作**永不进 Redis**。


## 三、Workflow 与 Verifier

### 3.1 Workflow 沙箱边界与超时绑定点（P1 闭合：AbortSignal）

**三个必须写清的事实**：

1. **`meta` 校验发生在任何执行之前**。`meta` 与 `args` 是普通 JSON 数据，无效 meta 在“run 发布之前”就被拒绝，**不产生任何副作用**。这正好支撑 Registry 准入守卫的“注册前拒绝”语义。
2. **脚本在全新的 Node 进程中运行**，按调用 Session 的文件沙箱策略执行，保留 `agent()` / `parallel()` / `pipeline()` / `phase()` / `log()` 等钩子。沙箱的准确含义是**文件策略与进程隔离**，VM **不是安全边界**。
3. **Workflow 引擎没有整体执行截止时间**：`Runs have no overall elapsed deadline`；`timeoutMs: null`；只有初始同步片段受 `syncTimeoutMs`（默认 5000ms）限制。

**超时绑定点（P1 修正）**：`WorkflowStartRequest` 包含 `signal?: AbortSignal`，caller 的 abort signal 生效，包括 enclosing tool deadline；“cancellation stops the managed process and disposes child agents”。因此“单次执行 5 分钟”由 `opc_hub` 在构造 `WorkflowStartRequest` 时**通过 `AbortSignal.timeout(300_000)` 绑定到 `signal` 字段**；超时触发取消 → 受管进程停止 → 子 Agent 处置 → 幂等恢复路径生效（已执行节点跳过）。

**并发上限**：`maxTotalAgents` 默认 1000，`maxConcurrentAgents` 默认 0（从可用 CPU 并行度解析，4C 机器上可能仅 3–4 个）。OPC-玄机对跨员工流程**显式设置 `maxConcurrentAgents`**（建议 4），并显式降低 `maxTotalAgents`（建议 50），不依赖自动解析，防止派工爆炸。`maxPendingCalls` 也限制 workflow 并发，设置时留余量。

### 3.2 Verifier 实际可配项、缓存口径与成本模型（P0 闭合：非代码流程 evidence_hash）

`dsh-llm-verifier` 的关键可配项（以插件设置页为准）：

| 配置项           | OPC-玄机设定                                                 | 依据                                              |
| :--------------- | :----------------------------------------------------------- | :------------------------------------------------ |
| **调用策略**     | Workflow 节点评判用 `smart`；**不用 `manual`**（过程选优仅在 `smart` 下生效，`manual/strict` 不进入该路径） | 触发场景按档位：`off`/`recovery`/`every-step`     |
| **最大并发数**   | 按单机容量显式设定（建议 4–8），不依赖未确认的默认值         | 插件有全局并发请求限制                            |
| **缓存目录**     | 显式指向持久化路径，避免重启后重复计费                       | 缓存目录在话题目录下的相对子目录，默认 `verifier` |
| **缓存条目上限** | 按预算设定                                                   | 成功评分持久化缓存的最大容量条目数                |
| **判官温度**     | 0.2（默认）；推理模型只接受默认温度时改回 1                  | 温度越低判决越可复现                              |
| **最终验收轮次** | 2（默认）：奇数轮不交换、偶数轮交换 A/B，抵消位置偏好        | 调低到 1 省一次调用但失去该保护                   |
| **裁判模型**     | **独立于 coding agent 的模型配置**                           | 支持从已配置 Provider 中指定裁判模型              |

**缓存键的真相**：评分缓存键**包含本轮文件改动文本**——“改动不同必然重新评分”。这条规则对代码类流程成立，但 OPC-玄机的高影响流程（`tax_monthly_prepare`、`subsidy_standard_update`、`inv_stock_in`）**大部分不涉及文件改动**，evidence 是结构化数据（勾稽结果、文号校验结果、四要素确认卡），不存在“文件改动文本”作为缓存键。

**P0 修正：非代码流程的 `evidence_hash` 口径**：

1. **代码类流程**沿用插件的“文件改动文本”键；
2. **非代码类流程由 `opc_hub` 封装层自行计算 `evidence_hash`**，口径为“参与判定结论的关键字段集合”——税务流程取“发票合计、流水合计、差异计数”；补贴流程取“文号、发布日期、适用期”；库存流程取“SKU、数量、单价、相对方”；
3. `evidence_hash` 的字段集**写入流程 `meta` 的 `verifier_policy`**，不同流程可配置不同字段集；
4. 非代码流程 `evidence_hash` 命中时，审计记录“缓存命中”；但**缓存命中不等于 Verifier 通过**——命中只省去重复调用，判定结论仍以首次完整采样的 verdict 为准。

**成本模型写入容量规划**：

- 高影响节点（`deadline_impact: true` 或涉金额阈值）× 三次采样 × 每次 evidence 变化即重评；
- `tax_monthly_prepare` 按周估算：勾稽节点与税负节点各 3 次采样，若每周 evidence 变化 2 次，约 12 次裁判调用/周；
- 在 `verifier_policy` 中按节点单独配置 `sampling`，**不做全局放大**；
- `opc_hub` 封装层对同一 `evidence_hash` 做本地去重。

### 3.3 Verifier 判别力的已知局限

公开实测数据：明显质量差的候选对方向正确率 10/10，难分候选对方向也 10/10（但分差极小，Bradley–Terry 软偏好权重约 50.4%），三份都合格的长任务在锦标赛中出现过 0.5/0.5/0.5 全平，最终靠**绝对分（`passesThreshold`）** 而非排名救场。**只有 `score` / `criteria` / `passesThreshold` 是绝对口径**；`scores` 是锦标赛偏好份额，不是绝对分。

**写入 8.6.3 的约束**：
- 采样投票适用于**存在可分辨方案差异**的场景；若三次采样均落在低分差区间，**不以投票结果自动通过，升级人工裁决**；
- Verifier 的**绝对分比相对排名更可信**；流程的 `goal` 应尽量写成可绝对判定的验收条件（金额合计、字段非空、差异计数），而非“比另一个好”；
- 可结构化校验的部分交给脚本，Verifier 只判无法结构化表达的部分。

**采样投票与插件 A/B 交换的层次澄清（P2）**：三次采样是 `opc_hub` 封装层的外部编排策略；插件的“最终验收轮次 2（奇数轮不交换、偶数轮交换）”是其内部机制。两者层次不同，**不修改插件的最终验收轮次**，插件的 A/B 交换仍按其默认 2 轮执行。


## 四、记忆与向量检索

### 4.1 嵌入模型与资源预算（P1 闭合：实测方法）

**本地优先，云端兜底**：有本地推理资源时使用本地嵌入模型（如 `bge-m3` 量化版本），数据不出内网；无本地资源时通过 DSH 已配置的云端 API 嵌入，但**敏感经验卡片与客户相关记忆强制本地模型**。

**实测方法（P1 修正）**：
1. 启动嵌入模型服务；
2. 用代表性批量（100 条文本）做一次完整嵌入；
3. 用 `ps` / `docker stats` 读取 RSS 峰值；
4. 取峰值 × 1.3 作为内存预算；
5. `shared_buffers = min(总内存 × 25%, 总内存 − 嵌入模型预算 − 2G)`。

若嵌入模型按需加载（非常驻），按峰值预算；若常驻，按稳态预算并留 30% 余量。实测基线与计算结果写入 Onboarding 检查清单。

### 4.2 向量表结构

```sql
CREATE TABLE embedding (
  id           BIGSERIAL PRIMARY KEY,
  source_type  TEXT NOT NULL,        -- lesson | skill | case | customer_memo
  source_id    BIGINT NOT NULL,
  content_hash TEXT NOT NULL,
  embedding    VECTOR(1024) NOT NULL, -- 维度与选定模型逐一核对
  model_id     TEXT NOT NULL,
  dimension    INTEGER NOT NULL,      -- 冗余记录，防配置漂移
  created_at   TIMESTAMPTZ DEFAULT now(),
  UNIQUE (source_type, source_id, model_id)
);
CREATE INDEX ON embedding USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
```

**增量策略**：内容变更比对 `content_hash`，仅重嵌入变化行；嵌入在“老板确认”动作发生时写入，草稿阶段不写入。


## 五、部署拓扑

### 5.1 单机部署（默认）

```
┌─────────────────────────────────────────────────────────────┐
│  单台服务器（4C/16G 起步）                                   │
│                                                             │
│  ┌─────────────────┐  ┌─────────────────┐                  │
│  │ DSH Web Profile  │  │ DSH Headless    │                  │
│  │ (老板交互/看板)  │  │ (夜间任务/引擎) │                  │
│  └────────┬────────┘  └────────┬────────┘                  │
│           │                    │                            │
│           └────────┬───────────┘                            │
│                    ▼                                        │
│           ┌────────────────┐                                │
│           │   PgBouncer    │  transaction mode              │
│           │  default_pool  │  = 20 (4C)                      │
│           └───────┬────────┘                                │
│                   ▼                                         │
│  ┌────────────────────────────────────┐                     │
│  │ PostgreSQL 16+ / pgvector          │                     │
│  │ 业务 + embedding(HNSW) + 审计       │                     │
│  │ + Workflow Registry + 快照          │                     │
│  └────────────────────────────────────┘                     │
└─────────────────────────────────────────────────────────────┘
```

**浏览器侧**：左插件栏“OPC公司管理”、中间会话、右侧 Web 面板；面板经 `WebHostAdapter`（原生插槽优先，否则 sandbox iframe + postMessage）连到 DSH Web，实时失效事件走 SSE；Headless 负责计划任务、读模型刷新与简报生成。面板不直连 PgBouncer/PG。

**内存分配**（16G）：`shared_buffers` ≈ 4G（25%），`effective_cache_size` ≈ 12G（75%）；启用本地嵌入模型时按 4.1 实测结果相应下调。

### 5.2 扩展触发条件

| 触发条件                                 | 动作                                            | 不做的事                   |
| :--------------------------------------- | :---------------------------------------------- | :------------------------- |
| 审计表 > 约 5000 万行或单库 > 100GB      | **审计表按月分区**（见 5.4）                    | 不换库、不读写分离         |
| HNSW 索引内存持续 > `shared_buffers` 60% | 降 `m` 至 8，或低价值向量降采样；仍不足再扩内存 | 不盲目加内存               |
| Workflow 并发逼近 `default_pool_size`    | 先调池与 `max_client_conn`                      | 不提前加只读副本           |
| 向量维度需要变更                         | 走 2.1 的 expand/contract runbook               | 不原地 `ALTER COLUMN TYPE` |

### 5.3 备份与 RPO/RTO

**默认基线：RPO ≤ 24h（每日逻辑备份），RTO ≤ 4h。** 启用 WAL 归档后 RPO 接近零。

| 层级                   | 方案                                                         | 保留                   |
| :--------------------- | :----------------------------------------------------------- | :--------------------- |
| **物理 + WAL（PITR）** | pgBackRest 或 `pg_basebackup` + 连续 WAL 归档                | WAL ≥ RPO 窗口         |
| **逻辑备份**           | 每日 `pg_dump -Fc` 关键业务表（`ledger`、`contract`、`stock_txn`、`conflict_queue`、`workflow_registry`） | 7–30 天                |
| **审计归档**           | 按 8.4 执行，JSONL + CSV + SHA-256 校验；**30 年保留项不得只存 PG 备份** | 独立于 PG 备份生命周期 |

若老板对财税数据要求更高，启用 WAL 归档使 RPO 接近零，Onboarding 中一句话说明“多花的是磁盘与恢复演练时间”。

### 5.4 审计表分区前置设计（P1 闭合）

**分区键必须提前预留**。在审计表设计阶段即将主键改为 `(id, created_at)` 复合主键，`created_at` 为分区键；**不做事后改主键**。

**分区切换步骤**：创建新分区 → `ATTACH PARTITION` → 验证 → 旧数据归档。分区后审计归档导出**按分区遍历**，不假设单表全量扫描。


## 六、可观测性（轻量）

不引入 ELK / Loki / Prometheus + Grafana / APM。

| 维度          | 方案                                                         |
| :------------ | :----------------------------------------------------------- |
| PG 健康       | `pg_stat_statements` 慢查询；`pg_stat_activity` 连接与长事务；`pgstattuple` 向量表膨胀 |
| Workflow 运行 | 流程看板（8.6.10）即运行时入口；生命周期事件落 PG，按 `workflow_instance_id` 聚合 |
| 审计完整性    | 每日导出后校验 SHA-256；**每次导出记录上一条导出文件哈希**，形成归档链（见下） |
| Verifier 成本 | Profile 中限制最大并发；统计裁判调用量，按周与容量规划对账   |
| Web 面板      | `as_of` 陈旧率、接口 p95、SSE 断线重连次数、导出失败数         |
| 归置流水线    | 收件箱积压量、分类置信度分布、确认/忽略比、抽取失败率         |
| 计划任务      | `next_run_at` 漂移、连续失败、任务积压、雷达新增条目与点开率   |

**审计哈希链的链头持久化（P1 闭合）**：哈希链的“当前链头”**持久化在 PostgreSQL 的 `audit_chain_head` 表中**，每次导出后更新。导出文件头部写入“上一条文件哈希 + 本条文件哈希 + 链头表快照”。恢复时**先校验链头表与最后一条导出文件的一致性**，不一致则告警并拒绝自动续链。

**PDF 输出工具链（P2）**：CSV 为结构化归档主格式；PDF 仅对关键凭证类输出可读副本，生成工具选 **Pandoc + 固定模板**，不引入额外运行时。


## 七、安全与合规的技术落点

| 要求                              | 技术落点                                                     |
| :-------------------------------- | :----------------------------------------------------------- |
| 敏感字段不落视图/中枢             | 客户敏感字段仅存 `customer_sensitive` 表，`opc_hub` 与视图查询不 JOIN 该表；跨域走一次性令牌，令牌表记录 `field_scope` 与 `expires_at` |
| 审计只经中枢写入                  | 员工插件通过 `opc_hub.audit.record()` 写审计；数据库角色对 `audit_log` 只有 INSERT，无 SELECT/UPDATE/DELETE |
| 视图级授权                        | `required_views` 在 Workflow 启动与 Registry 准入守卫两处校验；视图查询以参数化 SQL 封装 |
| 风险等级的写入目标解析（P0 闭合） | **每个员工插件为写工具在注册时声明 `write_targets`**（如 `["customer_sensitive","ledger"]`）；Registry 基于 `write_targets` 而非工具名判定风险；任一工具命中高风险域即标记高风险，**不依赖流程自述的 `scope` 或 `deadline_impact`** |
| 数据不出内网                      | 模型端点按 Profile 路由；嵌入模型与 Verifier 裁判模型均可指向本地；PgBouncer/PG 不监听公网 |
| 归档可迁移                        | 审计归档头写 `schema_version`；Drizzle 迁移与归档迁移脚本同链管理；30 年项同时输出 CSV/PDF |
| Web 面板隔离                      | 原生插槽优先；iframe 时 sandbox 不含 `allow-same-origin`，origin 白名单 + CSP + postMessage 请求 ID；面板不直连 DB |
| 会话/记忆授权                     | `web_session_grant` 绑定范围/用途/有效期；记忆按 scope；跨域单字段一次性令牌；撤回即失效 |
| 上传归置安全                      | 类型/大小白名单；本地存储；高风险域（财税/法务/客户敏感/合同/库存写入）一律确认后写回 |


## 八、Web 表现层与数据驾驶舱（v2.10 新增）

> **接口声明**：本节 `WebHostAdapter`、`hub.web.*`、`hub.session.*`、`hub.memory.*`、`/api/opc/web/*` 为 OPC-玄机对 DSH Web、会话与记忆能力的**封装约定，非 DSH 实际 API**。落地前须对照 DSH Web SDK/插件插槽、会话事件、记忆插件与鉴权契约逐项核对；不一致处以 DSH 为准并回写本节。

### 8.1 DSH 扩展点与适配层

DSH Web 可能提供三种插件承载方式，按优先级适配：

| 优先级 | 宿主能力                         | `opc_web` 实现方式                                            | 约束                                   |
| :----- | :------------------------------- | :------------------------------------------------------------ | :------------------------------------- |
| 1      | 原生 React/DOM 插槽              | 将面板组件挂载到右侧插槽；宿主提供会话事件与主题变量           | 不覆盖宿主全局样式；错误边界隔离       |
| 2      | 仅 iframe/自定义视图             | 独立 SPA 运行在 sandbox iframe；`postMessage` RPC 到宿主      | `allow-scripts`，禁止 `allow-same-origin`；origin 白名单 |
| 3      | 无右侧面板 API                   | 功能降级为“会话命令 + 独立本地页面”，并在设置页明确提示        | 不伪造“已嵌入”；P1 需与 DSH 确认插槽能力 |

**适配层契约**（设计示意）：

```ts
// 接口设计示意（非 DSH 实际 API）
interface WebHostAdapter {
  registerSidebarItem(item: {
    id: string;
    title: string;
    icon: string;
    badge?: number;
  }): Promise<void>;

  mountPanel(container: HTMLElement, ctx: PanelContext): Promise<void>;

  onSessionEvent(handler: (event: SessionEvent) => void): () => void;

  getSessionContext(req: SessionContextRequest): Promise<SessionContext>;
  openThread(req: OpenThreadRequest): Promise<void>;

  searchMemory(req: MemorySearchRequest): Promise<MemoryCard[]>;
  queryDashboard(req: DashboardQuery): Promise<DashboardSnapshot>;
}
```

**iframe/postMessage 安全规则**：
- `postMessage` 必须指定 `targetOrigin`，禁止 `*`；
- 消息含 `schema_version`、`request_id`、`capability_token`，30 秒超时；
- 宿主校验 origin 白名单与 token 作用域；token 绑定单次面板会话，默认 8 小时；
- 面板 CSP：`default-src 'self'; connect-src 'self'; img-src 'self' data:; script-src 'self'`；
- 不使用 `eval`、`new Function`、内联脚本；Markdown 渲染前消毒。

### 8.2 前端技术选型

| 项         | 选型                                   | 说明                                                     |
| :--------- | :------------------------------------- | :------------------------------------------------------- |
| 语言       | TypeScript                             | 与后端契约共享类型；`strict` 模式                         |
| UI         | React 19（宿主持插槽时）               | 若宿主只支持 iframe，同一 SPA 独立运行；不做 SSR          |
| 构建       | Vite                                   | 产物为静态资源，由 `opc_web` 托管                         |
| 图表       | ECharts（按需引入）                    | 驾驶舱折线/柱状/环形/热力；懒加载，首屏不阻塞             |
| 状态       | React 本地状态 + 服务端查询            | 不引入 Redux；服务端状态以 `as_of` 为准                   |
| 实时       | SSE；不支持时 15s 轮询                 | 只传失效事件与快照版本，不传敏感明细                     |
| 样式       | CSS 变量 + 宿主主题变量                | 跟随 DSH 明暗主题；右栏最小宽度 420px，最小高度 600px     |
| 可访问性   | 键盘可达、对比度 ≥4.5:1、焦点可见      | 图表提供表格替代视图                                     |
| 体积预算   | 首屏 JS ≤500KB gzip，图表按路由懒加载  | 超预算需说明                                               |

### 8.3 Web API（经中枢）

所有接口挂在 `opc_hub` 下，前端不得直连员工插件或数据库。

| 方法 | 路径                                   | 用途                                   | 鉴权/约束                                      |
| :--- | :------------------------------------- | :------------------------------------- | :--------------------------------------------- |
| GET  | `/api/opc/web/manifest`                | 返回插件栏信息、能力开关、schema 版本  | DSH 会话                                       |
| GET  | `/api/opc/web/dashboard?range=90d`     | 驾驶舱快照                             | 老板/授权角色；返回 `as_of`、`stale`、脚注     |
| GET  | `/api/opc/web/inbox?status=pending`    | 待归置收件箱                           | 老板/授权角色；敏感字段掩码                    |
| POST | `/api/opc/web/ingest`                  | 提交会话消息/附件引用                  | `Idempotency-Key`；写审计                      |
| POST | `/api/opc/web/ingest/:id/confirm`      | 确认/修改/忽略归置                     | 高风险域必须确认；写审计                       |
| GET  | `/api/opc/web/sessions/:id/context`    | 读取授权范围内会话上下文               | 会话授权 token；默认最近 20 条                 |
| POST | `/api/opc/web/sessions/:id/consent`    | 授予/撤回会话范围                      | 老板；有效期 ≤24h；写审计                      |
| POST | `/api/opc/web/memory/search`           | 记忆检索                               | scope 授权；返回来源与置信度                   |
| POST | `/api/opc/web/memory/propose`          | 记忆写入提议                           | 老板确认后落库；写审计                         |
| GET  | `/api/opc/web/tasks`                   | 计划任务列表与最近运行                 | 老板只读                                       |
| POST | `/api/opc/web/tasks/:key/run`          | 手动触发任务                           | 老板；幂等键；写审计                           |
| GET  | `/api/opc/web/radar?type=plugin`       | 插件/关键词雷达条目                    | 只读；附来源与发布时间                         |
| GET  | `/api/opc/web/events`                  | SSE 失效事件                           | 仅事件类型与版本号                             |
| POST | `/api/opc/web/export`                  | 导出驾驶舱/简报                        | 老板；CSV 为主；写审计                         |

**响应信封**：`{ schema_version, trace_id, as_of, data, warnings[] }`；`warnings` 用于“数据陈旧/未检索/冻结脚注”，前端不得吞掉。

**写接口约束**：`POST` 必须带 `Idempotency-Key`；服务端以 `(actor, route, key)` 去重；重复请求返回首次结果，不重复写业务表。

### 8.4 数据模型新增（Drizzle 迁移）

| 表                          | 关键字段                                                                 | 索引/约束                                              |
| :-------------------------- | :----------------------------------------------------------------------- | :----------------------------------------------------- |
| `web_ingest_item`           | `id, source_type, source_ref, content_hash, raw_ref, extracted_json, domain, confidence, status, idempotency_key, created_at, confirmed_by, confirmed_at` | `unique(content_hash, source_ref)`；`index(status, created_at)` |
| `web_session_grant`         | `id, session_id, message_ids[], purpose, granted_by, granted_at, expires_at, revoked_at` | `index(session_id, expires_at)`                        |
| `web_memory_proposal`       | `id, type, content, source_refs[], confidence, status, created_at, confirmed_at` | `index(status, created_at)`                            |
| `dashboard_metric_daily`    | `metric_id, date, dimension, value, unit, source, as_of, frozen_included` | `unique(metric_id, date, dimension)`                   |
| `dashboard_snapshot`        | `snapshot_id, range, generated_at, as_of, payload_json, stale, warnings_json` | `index(range, generated_at)`                           |
| `brief_item`                | `id, brief_date, type, title, summary, source_refs[], priority, status`  | `unique(brief_date, type, title)`；`index(brief_date)` |
| `radar_item`                | `id, radar_type, title, url, published_at, score, reason, risks[], dedupe_key, status` | `unique(radar_type, dedupe_key)`；`index(status, published_at)` |
| `scheduled_task`            | `task_key, cron, enabled, config_json, last_run_at, next_run_at, status`  | `unique(task_key)`；`index(enabled, next_run_at)`      |
| `task_run`                  | `id, task_key, scheduled_at, started_at, finished_at, status, error, result_ref, idempotency_key` | `unique(task_key, scheduled_at)`；`index(status, started_at)` |

**约束**：
- 所有表通过 Drizzle 迁移生成，不手改迁移文件；迁移与审计 `schema_version` 同链（2.3）；
- 驾驶舱读模型不落 `customer_sensitive` 原值；敏感字段只保留聚合或掩码；
- `task_run` 与 `web_ingest_item` 按月分区预留（主键含 `created_at`/`scheduled_at`），与审计分区策略一致；
- 保留期：雷达条目 180 天、任务运行 1 年、归置原文按老板配置（默认 1 年）；审计按 8.4 产品文档。

### 8.5 调度与并发

- 调度器运行在 Headless Profile；`scheduled_task` 保存 cron 与 `next_run_at`，进程重启后从 PG 恢复。
- 任务领取用短事务 `SELECT … FOR UPDATE SKIP LOCKED LIMIT 1`，提交后再执行；**不使用 advisory lock**（PgBouncer transaction 模式不支持跨语句会话状态）。
- 幂等键 `(task_key, scheduled_at)`；重复触发直接返回已有 `task_run`。
- 重试 3 次，指数退避（1m/5m/15m）；超限置 `failed` 并告警，保留上次成功结果。
- 并发上限：4C 机器同时执行 2 个后台任务；驾驶舱查询优先，任务让路。
- 外部检索/摘要调用绑定 `AbortSignal.timeout()`：检索 60s、摘要 120s、驾驶舱聚合 30s；超时视为失败并降级。
- `plugin_radar_scan` 等推荐任务**只写 `radar_item`，不触发安装**；安装必须由老板在会话或设置页显式确认。

### 8.6 聚合与缓存

- 读模型优先常规表增量 upsert（`dashboard_metric_daily`），重聚合用物化视图 `REFRESH MATERIALIZED VIEW CONCURRENTLY`（需唯一索引）。
- 驾驶舱一次查询在只读 `REPEATABLE READ` 事务内完成，统一 `as_of`；冻结事件按“总额（含冻结）+ 脚注”输出。
- 缓存：进程内 LRU（5 分钟）+ ETag；领域事件使缓存失效；**v1 不引入 Redis**。
- 简报生成读取当日已聚合快照，不重新扫描业务主表；生成失败保留上一版并标注。
- SSE 仅推送 `{type, snapshot_version, as_of}`，前端收到后重新拉取快照；断线重连按 `snapshot_version` 补齐。

### 8.7 安全与隐私落点

| 要求                 | 落点                                                                 |
| :------------------- | :------------------------------------------------------------------- |
| 面板鉴权             | DSH 会话 + `opc_hub` capability token；角色校验；CSRF token          |
| iframe 隔离          | sandbox 不含 `allow-same-origin`；origin 白名单；CSP 禁止内联脚本    |
| 会话引用             | `web_session_grant` 绑定范围/用途/有效期；撤回即失效；引用写审计     |
| 记忆检索             | scope 授权；敏感记忆只返回标记；跨域单字段走一次性令牌（≤5min）       |
| 上传归置             | 类型/大小白名单；本地存储；病毒扫描可选；高风险写入必须确认           |
| 敏感字段不上面板     | 驾舱读模型不 JOIN `customer_sensitive`；接口层再次脱敏               |
| 审计                 | 面板/会话/记忆/归置/任务事件统一 `opc_hub.audit.record()`；不可直写   |
| 导出                 | CSV 为主；PDF 走 Pandoc 固定模板；文件头写 `schema_version`/`as_of`   |
| 速率限制             | 每会话 60 req/min；导出 5 次/小时；超限 429 并写审计                 |

### 8.8 性能预算与容量

| 指标                         | 目标（4C/16G 本地）                         |
| :--------------------------- | :------------------------------------------ |
| 面板首屏                     | ≤2s（静态资源本地加载）                     |
| 驾驶舱查询（90 天）          | p95 ≤500ms                                  |
| 归置分类（单条）             | p95 ≤3s（含 OCR/ASR 时按实际另计）          |
| 事件到面板刷新               | ≤5s                                         |
| 计划任务调度漂移             | ≤60s                                        |
| 并发会话                     | 1 老板 + ≤10 会话；后台任务并发 ≤2          |
| 雷达单次检索                 | ≤60s；超时降级                              |

### 8.9 测试策略

| 层级     | 范围                                                                 | 工具/方式                                      |
| :------- | :------------------------------------------------------------------- | :--------------------------------------------- |
| 单元     | 分类、归置决策、驾驶舱快照、任务去重、插件评分、权限判定             | `node --test` + TypeScript 类型剥离            |
| 契约     | `WebHostAdapter`、Web API schema、SSE 事件、iframe postMessage       | DSH mock host；JSON schema 快照                |
| 集成     | 归置→确认→写回→读模型刷新；任务领取→执行→失败重试                    | 本地 PostgreSQL；Drizzle 迁移                  |
| E2E      | 三栏：上传→收件箱→确认→驾驶舱；会话引用→记忆检索→授权撤回            | Playwright                                     |
| 安全     | 敏感字段不出接口；越权视图；origin/CSRF；审计完整性；上传类型        | 负向用例 + 响应体扫描                          |
| 性能     | 驾驶舱 90 天查询、SSE 刷新、任务积压                                  | `autocannon`/轻量压测；记录 p95                |
| CI       | Node 24.9、最新 24、26；`npm test` + `npm run typecheck`             | 三版本矩阵；失败阻断合并                       |

**测试数据**：全部使用合成数据或脱敏快照；禁止真实客户敏感字段进入测试夹具；`test_mode=true` 的审计不计入业务统计。

### 8.10 实施顺序与回滚

1. **P1**：`manifest` + 左栏入口 + 右栏驾驶舱只读快照 + 待归置收件箱 + `dashboard_refresh`/`daily_brief`；
2. **P2**：会话桥、记忆桥、归置写回确认、插件雷达/关键词雷达、SSE；
3. **P3**：多角色视图、下钻增强、导出 PDF、驾驶舱自定义布局。

**回滚**：`opc_web` 可独立停用，停用后左栏入口消失、右栏显示不可用提示，不影响中枢/员工/Workflow；读模型与归置表保留，重新启用后从 `as_of` 恢复。计划任务停用后不删除历史 `task_run`；插件推荐不产生安装副作用，回滚无下游不可逆动作。


### 8.11 员工包与插件生命周期（v2.11 新增）

**目标**：员工插件可独立安装、启用、停用、卸载，并可打包迁移到另一中枢；包只含插件代码/配置/流程，不含业务数据与凭据。

**包格式**：`opc-employee-package` v1（JSON 信封）：

```json
{
  "format": "opc-employee-package",
  "formatVersion": "1",
  "manifest": {
    "pluginId": "opc_wbs",
    "employeeCode": "WBS",
    "displayName": "WBS 员工",
    "version": "0.1.0",
    "minHubVersion": "0.2.1",
    "schemaVersion": "1",
    "requiredViews": ["view_project_status"],
    "tools": ["opc_wbs_decompose"],
    "writeTargets": ["wbs_node"],
    "singleWorkflows": ["wbs_baseline_change"],
    "dependencies": []
  },
  "files": [{ "path": "workflows/wbs_baseline_change.ts", "sha256": "…", "contentBase64": "…" }],
  "checksum": "sha256(canonical(manifest + files))"
}
```

**导入校验顺序**：格式/大小 → checksum → manifest schema → `pluginId/version` → `minHubVersion/schemaVersion` → 依赖插件 → 视图/工具/写目标合法性 → 路径穿越/文件类型 → dry-run 差异报告 → 老板确认 → 安装（默认停用）→ 二次确认启用。

**边界**：
- 包默认不含 `biz.*` 业务数据、`.env`、令牌、客户敏感字段；含数据导出必须单独确认、脱敏、审计。
- 导入失败回滚，不留半安装插件/流程/授权；同名插件不静默覆盖运行中版本。
- 停用不删除业务数据；卸载默认保留数据并转只读，删除须老板确认。
- 导入/导出、安装/启用/停用/卸载均写审计；`ref.employee_package`/`ref.employee_import_job` 记录包与任务状态。

## 九、选型汇总表

| 层次       | 选型                                         | v2.10 修订点                                                 |
| :--------- | :------------------------------------------- | :----------------------------------------------------------- |
| 运行时     | DSH Profile/Bundle/patch 三层装配            | 不变                                                         |
| Node.js    | ≥ 24.9                                       | 不变                                                         |
| 关系数据库 | PostgreSQL 16+                               | 不变                                                         |
| 向量检索   | pgvector + HNSW                              | **cutover 单事务原子性**；`ef_search` 事务内 `SET LOCAL`；>2000 维降级精确扫描 |
| ORM/迁移   | Drizzle                                      | 单向采用约束不变                                             |
| 连接池     | PgBouncer transaction                        | 4C：`default_pool_size=20`、`max_client_conn=200`、`min_pool_size=2` |
| 消息队列   | 不引入（v1 不部署 Redis）                    | 不变                                                         |
| Workflow   | DSH Workflow Engine                          | **超时绑定点**：`AbortSignal.timeout(300_000)` 绑到 `WorkflowStartRequest.signal`；`maxConcurrentAgents` 显式设 4；`maxTotalAgents` 显式降至 50 |
| Verifier   | `dsh-llm-verifier`                           | **非代码流程 `evidence_hash` 口径**；调用策略 `smart`；采样投票与插件 A/B 轮次层次澄清；绝对分优先 |
| 嵌入       | 本地优先，云端兜底                           | **实测方法**：RSS 峰值 × 1.3 反推 `shared_buffers`           |
| 部署       | 单机 + PgBouncer + PG/pgvector               | 扩展触发条件不变；**审计表分区键前置**                       |
| 备份       | pgBackRest/WAL + 逻辑备份 + 开放格式审计归档 | **哈希链链头持久化于 `audit_chain_head` 表**；PDF 用 Pandoc  |
| Web 表现层 | `opc_web` + `WebHostAdapter`                 | 原生插槽优先，否则 sandbox iframe + postMessage；面板不直连 DB |
| 前端       | TypeScript + React 19 + Vite + ECharts       | 首屏 ≤500KB gzip；图表懒加载；跟随 DSH 主题                  |
| 实时       | SSE（不支持时 15s 轮询）                     | 只推失效事件与快照版本，不推敏感明细                         |
| 计划任务   | PG `scheduled_task`/`task_run` + SKIP LOCKED | 不用 Redis/advisory lock；`(task_key, scheduled_at)` 幂等     |
| 雷达检索   | 外部 MCP/搜索源                              | 只推荐不自动安装；附来源/许可证/权限/风险；失败标注“未检索”  |

---

## 附：审阅问题闭合对照

| 审阅问题                           | 本版处理                                                     | 位置 |
| :--------------------------------- | :----------------------------------------------------------- | :--- |
| cutover 原子性（P0）               | **单事务内完成 drop/rename/retype**；`lock_timeout` 超时整体回滚；失败时应用仍指向旧列 | 2.1  |
| 非代码流程 Verifier 缓存口径（P0） | **`evidence_hash` 按参与判定的关键字段计算**，写入 `verifier_policy`；命中≠通过，首次必须完整采样 | 3.2  |
| 风险等级写入目标解析（P0）         | **员工插件声明 `write_targets`**，Registry 据此判定；不依赖流程自述 | 七   |
| AbortSignal 绑定点（P1）           | **`AbortSignal.timeout(300_000)` 绑定到 `WorkflowStartRequest.signal`**；取消→进程停止→幂等恢复 | 3.1  |
| 哈希链链头存储（P1）               | **`audit_chain_head` 表**持久化链头；恢复时校验链头与最后导出文件一致性 | 六   |
| 审计表分区前置（P1）               | **主键 `(id, created_at)`** 提前预留；分区切换按 `ATTACH PARTITION`；导出按分区遍历 | 5.4  |
| 嵌入模型实测方法（P1）             | **RSS 峰值 × 1.3** 反推 `shared_buffers` 公式写入 Onboarding | 4.1  |
| `maxConcurrentAgents`（P2）        | 跨员工流程**显式设 4**，不依赖 CPU 自动解析                  | 3.1  |
| 采样投票与 A/B 轮次关系（P2）      | **澄清层次不同**，不修改插件最终验收轮次                     | 3.3  |
| PgBouncer `min_pool_size`（P2）    | 改为 **2**，`reserve_pool_size = 3`                          | 2.4  |
| PDF 工具链（P2）                   | **Pandoc + 固定模板**                                        | 六   |

**残余风险（运营期观察）**：
1. 视图级授权的“可扫描性”属约定约束，多角色出现时需重评是否升级字段级；
2. 补贴官方文件格式不统一，AI 抽取文号/适用期可能出错，候选卡必须保留原文链接；
3. 业务事件级冻结在同一事件反复冲突时可能长期挂脚注，需月报提示清理；
4. 跨员工流程集中 Registry，故障演练须在 P1 完成并形成演练报告；
5. Verifier 分级采样增加调用成本，需在成本与可靠性间做容量规划；
6. 自动生成代码即使通过三关 + 影子 + 观察期，仍可能存在未覆盖边界，观察期长度与样本量需按流程频率持续校准；
7. 独立 Verifier Agent 与 coding agent 模型配置分离增加运维复杂度，需在 P2 前完成模型路由与成本评估；
8. 低频流程长期处于“观察期延长”，若积累过多需运营定期审查并人工决定是否提前转正。

**v2.10 新增闭合项**：

| 新增点                             | 处理                                                         | 位置 |
| :--------------------------------- | :----------------------------------------------------------- | :--- |
| DSH Web 扩展点未知（P0）           | 定义 `WebHostAdapter` 三档适配：原生插槽 → sandbox iframe → 降级独立页；落地前核对 DSH 契约 | 8.1  |
| 面板越权读会话/记忆（P0）          | 会话授权绑定范围/用途/有效期；记忆按 scope；跨域单字段一次性令牌；撤回即失效 | 8.7  |
| 上传归置误写（P0）                 | 分类置信度分级；财税/法务/客户敏感/合同/库存写入一律确认；幂等键防重复 | 8.4、8.5 |
| 驾驶舱数据陈旧/伪造（P1）          | 统一 `as_of`；陈旧徽标；不填 0；冻结脚注；SSE 只推版本号     | 8.6  |
| 计划任务重复执行（P1）             | `(task_key, scheduled_at)` 唯一；`FOR UPDATE SKIP LOCKED`；不用 advisory lock | 8.5  |
| 插件推荐被误解为自动安装（P1）     | 只写 `radar_item`；安装必须老板显式确认；推荐卡列权限与数据驻留风险 | 8.5、8.10 |
| iframe 安全（P2）                  | sandbox 不含 `allow-same-origin`；origin 白名单；CSP；postMessage 请求 ID/超时 | 8.1、8.7 |

**v2.10 残余风险**：
1. DSH Web 若未提供右侧面板插槽，P1 只能降级为“会话命令 + 独立页面”，需尽早确认；
2. 会话/记忆授权的“范围可理解性”依赖 UI 表达，需在可用性测试中验证老板是否真正理解授权边界；
3. 归置分类依赖规则 + 模型，长尾表达仍可能误分，收件箱与确认卡是必要兜底；
4. 外部检索源的稳定性与版权/引用合规需运营期持续评估；
5. 驾驶舱读模型与业务表存在秒级延迟，需在界面明确 `as_of`，避免被当作实时账；

---

**一句话**：v2.10 在 v2.9 的 Phase 1 部署基线上补齐老板侧表现层——`opc_web` 插件栏入口、右侧驾驶舱、会话桥/记忆桥、上传归置流水线与 PG 原生计划任务；所有读取按会话/scope 授权，所有写入经中枢确认与审计，插件推荐只推荐不自动安装。**可作为 Web 表现层 P1 的设计基线。**