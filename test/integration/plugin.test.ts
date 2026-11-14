/**
 * DSH 插件装配集成测试：createHub 建服务、工具定义齐全、工具可执行且返回结构化文本。
 */
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { seedEmployee, resetDb } from "../helpers.ts";
import { createHub, type Hub } from "../../src/plugin/index.ts";

let hub: Hub;

before(() => {
  hub = createHub({ dsn: process.env.OPC_TEST_DSN ?? undefined });
});

after(async () => {
  await hub.pool.end();
});

beforeEach(async () => {
  await resetDb(hub.pool);
  await hub.scheduler.seedDefaults();
});

test("工具清单：40 个 opc_* 工具且参数 schema 完整", () => {
  const names = hub.tools.map((tool) => tool.name).sort();
  assert.equal(names.length, 40);
  assert.ok(names.includes("opc_health"));
  assert.ok(names.includes("opc_workflow_register"));
  assert.ok(names.includes("opc_task_upsert"));
  assert.ok(names.includes("opc_agent_deploy"));
  assert.ok(names.includes("opc_agent_dispatch"));
  assert.ok(names.includes("opc_agent_result"));
  assert.ok(names.includes("opc_agent_health"));
  assert.ok(names.includes("opc_agent_pause"));
  assert.ok(names.includes("opc_project_bootstrap"));
  assert.ok(names.includes("opc_ops_usage_summary"));
  assert.ok(names.includes("opc_ops_issues_sync"));
  assert.ok(names.includes("opc_project_from_idea"));
  for (const tool of hub.tools) {
    assert.equal(tool.parameters.type, "object", tool.name);
    assert.ok(tool.description.length > 5, tool.name);
  }
});

test("opc_health：可执行并返回 PG/pgvector/任务信息", async () => {
  const health = hub.tools.find((tool) => tool.name === "opc_health");
  assert.ok(health !== undefined);
  const result = (await health.execute({})) as { type: string; text: string };
  const data = JSON.parse(result.text);
  assert.equal(data.pg, true);
  assert.equal(data.pgvector, true);
  assert.equal(data.registeredTasks.length, 17);
});

test("opc_task_list / opc_task_upsert：配置驱动可增改", async () => {
  const upsert = hub.tools.find((tool) => tool.name === "opc_task_upsert");
  const list = hub.tools.find((tool) => tool.name === "opc_task_list");
  assert.ok(upsert !== undefined && list !== undefined);
  await upsert.execute({ taskId: "tax_reminder", cron: "15 9 * * *", timezone: "Asia/Shanghai" });
  const listed = JSON.parse(((await list.execute({})) as { text: string }).text) as { tasks: { taskId: string; cron: string }[] };
  assert.equal(listed.tasks.find((task) => task.taskId === "tax_reminder")?.cron, "15 9 * * *");
});

test("opc_view_query：未授权时抛出带错误码的异常", async () => {
  await seedEmployee(hub.pool, "opc_finance", { views: [] });
  const query = hub.tools.find((tool) => tool.name === "opc_view_query");
  assert.ok(query !== undefined);
  await assert.rejects(
    () => query.execute({ pluginId: "opc_finance", viewId: "view_ar_ap" }),
    /ERR-AUTHZ-001/,
  );
});
