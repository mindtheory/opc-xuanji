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
| `opc-service` | 财税、法务、行政、战略、项目、情报、客户 | 纯服务型   |
| `opc-trade`   | 上 + 货栈                                | 有实物销售 |
| `opc-full`    | 全量（车务按 1.3 规则决定是否独立）      | 混合型     |

Web 形态（`dsh web`）负责老板交互与看板，Headless 形态负责夜间任务与 Workflow 引擎常驻，两者共享同一 PostgreSQL。


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

**本地优先，云端兜底**：有本地推理资源时使用本地嵌入模型（如 `bge-m3` 量化版本），数据不出私有网络；无本地资源时通过 DSH 已配置的云端 API 嵌入，但**敏感经验卡片与客户相关记忆强制本地模型**。

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

**审计哈希链的链头持久化（P1 闭合）**：哈希链的“当前链头”**持久化在 PostgreSQL 的 `audit_chain_head` 表中**，每次导出后更新。导出文件头部写入“上一条文件哈希 + 本条文件哈希 + 链头表快照”。恢复时**先校验链头表与最后一条导出文件的一致性**，不一致则告警并拒绝自动续链。

**PDF 输出工具链（P2）**：CSV 为结构化归档主格式；PDF 仅对关键凭证类输出可读副本，生成工具选 **Pandoc + 固定模板**，不引入额外运行时。


## 七、安全与合规的技术落点

| 要求                              | 技术落点                                                     |
| :-------------------------------- | :----------------------------------------------------------- |
| 敏感字段不落视图/中枢             | 客户敏感字段仅存 `customer_sensitive` 表，`opc_hub` 与视图查询不 JOIN 该表；跨域走一次性令牌，令牌表记录 `field_scope` 与 `expires_at` |
| 审计只经中枢写入                  | 员工插件通过 `opc_hub.audit.record()` 写审计；数据库角色对 `audit_log` 只有 INSERT，无 SELECT/UPDATE/DELETE |
| 视图级授权                        | `required_views` 在 Workflow 启动与 Registry 准入守卫两处校验；视图查询以参数化 SQL 封装 |
| 风险等级的写入目标解析（P0 闭合） | **每个员工插件为写工具在注册时声明 `write_targets`**（如 `["customer_sensitive","ledger"]`）；Registry 基于 `write_targets` 而非工具名判定风险；任一工具命中高风险域即标记高风险，**不依赖流程自述的 `scope` 或 `deadline_impact`** |
| 数据不出私有网络                      | 模型端点按 Profile 路由；嵌入模型与 Verifier 裁判模型均可指向本地；PgBouncer/PG 不监听公网 |
| 归档可迁移                        | 审计归档头写 `schema_version`；Drizzle 迁移与归档迁移脚本同链管理；30 年项同时输出 CSV/PDF |


## 八、选型汇总表

| 层次       | 选型                                         | v2.9 修订点                                                  |
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

---

**一句话**：v2.9 把上一轮审阅指出的**三个“写在文档里看着对、编码时才发现无法直接落地”的执行缺口**——cutover 原子性、非代码流程的 Verifier 缓存口径、风险等级的写入目标解析——全部收敛为可直接编码的规则；同时补齐了超时绑定点、哈希链链头、分区前置设计与嵌入模型实测方法。**可作为 Phase 1 的部署基线。**