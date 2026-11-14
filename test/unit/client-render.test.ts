/**
 * client.js 组件渲染冒烟（零依赖，不启动浏览器）。
 *
 * 目的：捕获“只在渲染时才会爆”的错误（引用未定义函数、空值直接拼进树等）。
 * 做法：用最小假 React 执行 client.js 的组件函数并递归构造元素树；不做样式/交互断言。
 * 背景：v2.23 自动驾驶页曾因引用未定义的 textOf 导致整块主面板白屏，本用例防止同类回归。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const CLIENT = new URL("../../client.js", import.meta.url);
const EXPORTS_ANCHOR = "    exports.apply = apply;";
const EXPORTS_DEBUG = "    exports.__test = { AutopilotTab: AutopilotTab, ProjectOverviewCard: ProjectOverviewCard, ProjectInfoCard: ProjectInfoCard, CurrentRunCard: CurrentRunCard, RoadmapCard: RoadmapCard, RunsCard: RunsCard, Console: Console };";

const Fragment = Symbol("Fragment");

interface ElementNode { type: unknown; props: Record<string, unknown> }

function createElement(type: unknown, props?: Record<string, unknown> | null, ...children: unknown[]): ElementNode {
  const merged: Record<string, unknown> = { ...(props ?? {}) };
  if (children.length > 0) merged.children = children.length === 1 ? children[0] : children;
  return { type, props: merged };
}

let hookValues: unknown[] = [];
let hookIndex = 0;

function resetHooks(values: unknown[] = []): void {
  hookValues = values;
  hookIndex = 0;
}

const fakeReact = {
  Fragment,
  createElement,
  useState(initial: unknown): [unknown, (value: unknown) => void] {
    const value = hookIndex < hookValues.length ? hookValues[hookIndex] : initial;
    hookIndex += 1;
    return [value, () => undefined];
  },
  useEffect(): void { /* 测试不执行副作用 */ },
  useRef<T>(initial: T): { current: T } { return { current: initial }; },
};

async function loadComponents(): Promise<Record<string, (props: Record<string, unknown>) => unknown>> {
  const raw = await readFile(CLIENT, "utf8");
  assert.ok(raw.includes(EXPORTS_ANCHOR), "client.js 需保留 exports.apply 锚点用于测试装载");
  const patched = raw.replace(EXPORTS_ANCHOR, `${EXPORTS_DEBUG}\n${EXPORTS_ANCHOR}`);
  let captured: { factory(require: (id: string) => unknown): { __test?: Record<string, (props: Record<string, unknown>) => unknown> } } | null = null;
  const sandbox: Record<string, unknown> = {
    console,
    window: { __ModuleLoader__: { load(definition: typeof captured) { captured = definition; } } },
    require(id: string) { return id === "react" ? fakeReact : undefined; },
    document: { documentElement: { lang: "zh" } },
    fetch: async () => ({ ok: true, json: async () => ({ code: 0, data: {} }) }),
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(patched, sandbox, { filename: "client.js" });
  assert.ok(captured !== null, "client.js 应通过 window.__ModuleLoader__ 注册工厂");
  const exported = (captured as { factory(require: (id: string) => unknown): { __test?: Record<string, (props: Record<string, unknown>) => unknown> } }).factory((id) => (id === "react" ? fakeReact : undefined));
  const components = exported.__test;
  assert.ok(components !== undefined, "client.js 测试导出缺失");
  return components;
}

function render(node: unknown, depth = 0): void {
  if (node === null || node === undefined || node === false) return;
  assert.ok(depth < 80, "组件树递归过深，可能存在自引用");
  if (Array.isArray(node)) {
    for (const item of node) render(item, depth);
    return;
  }
  if (typeof node !== "object") return;
  const element = node as ElementNode;
  if (element.type === Fragment) { render(element.props.children, depth); return; }
  if (typeof element.type === "function") {
    const fn = element.type as (props: Record<string, unknown>) => unknown;
    render(fn(element.props ?? {}), depth + 1);
    return;
  }
  if (typeof element.type === "string") render(element.props.children, depth);
}

const NOW = new Date().toISOString();
const steps = ["register", "checkout", "scan", "profile", "scaffold", "pipeline", "plans", "deploy", "decisions", "done"]
  .map((stage, index) => ({ stage, label: stage, status: index < 5 ? "ok" : index === 5 ? "running" : "pending", startedAt: NOW, endedAt: index < 5 ? NOW : null, durationMs: index < 5 ? 1000 : null, detail: null }));
const run = { id: 1, trigger: "manual", status: "running", stage: "pipeline", stageLabel: "测试流水线", steps, result: { ok: true }, error: null, startedAt: NOW, endedAt: null, durationMs: null };
const devContent = { weeks: 3, description: "说明", phases: [{ key: "freeze", title: "需求冻结", startDate: "2026-11-14", endDate: "2026-11-17", owner: "项目监理", status: "planned", deliverables: ["范围清单"] }], workBreakdown: ["src"], modules: [{ name: "src", files: 1, loc: 10 }], assumptions: ["假设"], risks: ["风险"] };
const testContent = { cases: ["TC-AUTO-001"], caseDetails: [{ code: "TC-AUTO-001", title: "构建冒烟", priority: "P1", kind: "auto", focus: "npm run build" }], testTypes: ["unit"], testFiles: ["test/a.test.js"], ci: [], focusAreas: ["src"], entryCriteria: "进入", exitCriteria: "退出" };
const deployContent = { environmentId: 2, runtime: { docker: "Dockerfile", ci: [], scripts: { build: "npm run build" } }, targets: [{ name: "test", strategy: "docker", approval: "manual" }], steps: ["构建镜像"], rollback: "回滚", artifacts: ["镜像"] };
const roadmap = { weeks: 3, startDate: "2026-11-14", endDate: "2026-11-30", phases: devContent.phases, milestones: [{ id: 1, name: "需求冻结", status: "planned", targetDate: "2026-11-17", owner: "项目监理", evidence: "证据" }], plans: [
  { planKind: "dev", version: 1, title: "开发计划", status: "draft", generatedAt: NOW, content: devContent },
  { planKind: "test", version: 1, title: "测试计划", status: "draft", generatedAt: NOW, content: testContent },
  { planKind: "deploy", version: 1, title: "部署计划", status: "draft", generatedAt: NOW, content: deployContent },
] };
const item = { id: 3, name: "演示项目", description: "描述", stage: "planning", projectType: "software", status: "running", statusLabel: "运行中", archivedAt: null, archiveReason: null, repository: { kind: "svn", url: "svn://host/trunk" }, lastCheckout: null, currentRun: run, lastRun: run, planCount: 3, pendingDecisions: 2 };
const summary = { projectId: 3, project: { id: 3, name: "演示项目", stage: "planning", projectType: "software", description: "描述" }, status: "waiting_decision", statusLabel: "待裁决", description: "描述", descriptionSource: "README.md", archivedAt: null, archiveReason: null, checkout: { status: "ok", vcs_kind: "svn", file_count: 1 }, scan: { languages: { javascript: 1 }, tests: [], ci: [], findings: {} }, plans: roadmap.plans.map((plan) => ({ plan_kind: plan.planKind, version: plan.version, title: plan.title, status: plan.status, content: plan.content, generated_at: plan.generatedAt })), decisions: [{ id: 1, topic: "license", question: "？", risk_level: "medium", status: "pending" }], pendingDecisions: 1, profile: { tech_stack: { primaryLanguage: "javascript" }, software_profile: {} }, scaffold: null, pipeline: [], deploy: [], runs: [run], currentRun: run, roadmap, milestones: roadmap.milestones };

test("client.js 自动驾驶组件可完整渲染（防白屏回归）", async () => {
  const components = await loadComponents();
  for (const name of ["AutopilotTab", "ProjectOverviewCard", "ProjectInfoCard", "CurrentRunCard", "RoadmapCard", "RunsCard"]) {
    assert.equal(typeof components[name], "function", `缺少组件 ${name}`);
  }
  resetHooks();
  assert.doesNotThrow(() => render(createElement(components.ProjectOverviewCard, { projects: [item], rows: [item], counts: { total: 1, running: 1 }, filter: "active", selectedId: "3", busyId: "", onFilter() {}, onSelect() {}, onArchive() {}, onUnarchive() {} })));
  assert.doesNotThrow(() => render(createElement(components.ProjectInfoCard, { project: { id: 3, name: "演示项目", stage: "planning", projectType: "software" }, status: "running", statusLabel: "运行中", archived: false, description: "描述", descriptionSource: "README.md", tech: { primaryLanguage: "javascript", frameworks: ["express"] }, repository: { kind: "svn", url: "svn://host/trunk" }, busy: false, onArchive() {}, onUnarchive() {}, onRefresh() {} })));
  assert.doesNotThrow(() => render(createElement(components.CurrentRunCard, { run, last: run })));
  assert.doesNotThrow(() => render(createElement(components.RoadmapCard, { roadmap, plans: roadmap.plans })));
  assert.doesNotThrow(() => render(createElement(components.RunsCard, { runs: [run], loading: false })));
});

test("client.js 自动驾驶页签初始化渲染不抛错", async () => {
  const components = await loadComponents();
  // useState 顺序：filter=active、list 加载态、selected 空、summary 无、repos 无、表单默认……
  resetHooks(["active"]);
  assert.doesNotThrow(() => render(createElement(components.AutopilotTab, { flash() {} })));
  // 已加载状态下走详情路径（项目信息/当前执行/路线图/执行记录）
  resetHooks([
    "active",
    { loading: false, error: "", data: { items: [item], counts: { total: 1, active: 1, running: 1 } } }, 0,
    "3",
    { loading: false, error: "", data: summary }, 0,
    { loading: false, error: "", data: { projectId: "3", items: [] } }, 0,
    { name: "", repositoryUrl: "", branch: "main", kind: "git", revision: "", authRef: "", healthUrl: "", scaffold: true, pipeline: true, deployTest: true },
    false, null,
    { idea: "", repositoryUrl: "", branch: "", kind: "git", revision: "", authRef: "" },
    [], null, "",
  ]);
  assert.doesNotThrow(() => render(createElement(components.AutopilotTab, { flash() {} })));
});
