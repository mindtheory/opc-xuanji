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
const EXPORTS_DEBUG = "    exports.__test = { AutopilotTab: AutopilotTab, NewProjectTab: NewProjectTab, PlanAutoCard: PlanAutoCard, CompanyProfileCard: CompanyProfileCard, ProjectOverviewCard: ProjectOverviewCard, ProjectInfoCard: ProjectInfoCard, CurrentRunCard: CurrentRunCard, RoadmapCard: RoadmapCard, RunsCard: RunsCard, Console: Console };";

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

/** 深度遍历渲染树（含函数组件展开），收集满足条件的元素。 */
function collectElements(node: unknown, predicate: (element: ElementNode) => boolean, out: ElementNode[] = [], depth = 0): ElementNode[] {
  if (node === null || node === undefined || node === false) return out;
  assert.ok(depth < 80, "组件树递归过深，可能存在自引用");
  if (Array.isArray(node)) {
    for (const item of node) collectElements(item, predicate, out, depth);
    return out;
  }
  if (typeof node !== "object") return out;
  const element = node as ElementNode;
  if (element.type === Fragment) { collectElements(element.props.children, predicate, out, depth); return out; }
  if (typeof element.type === "function") {
    collectElements((element.type as (props: Record<string, unknown>) => unknown)(element.props ?? {}), predicate, out, depth + 1);
    return out;
  }
  if (predicate(element)) out.push(element);
  collectElements(element.props.children, predicate, out, depth);
  return out;
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
  for (const name of ["AutopilotTab", "NewProjectTab", "PlanAutoCard", "CompanyProfileCard", "ProjectOverviewCard", "ProjectInfoCard", "CurrentRunCard", "RoadmapCard", "RunsCard"]) {
    assert.equal(typeof components[name], "function", `缺少组件 ${name}`);
  }
  resetHooks();
  assert.doesNotThrow(() => render(createElement(components.ProjectOverviewCard, { projects: [item], rows: [item], counts: { total: 1, running: 1 }, filter: "active", selectedId: "3", busyId: "", onFilter() {}, onSelect() {}, onArchive() {}, onUnarchive() {} })));
  assert.doesNotThrow(() => render(createElement(components.ProjectInfoCard, { project: { id: 3, name: "演示项目", stage: "planning", projectType: "software" }, status: "running", statusLabel: "运行中", archived: false, description: "描述", descriptionSource: "README.md", tech: { primaryLanguage: "javascript", frameworks: ["express"] }, repository: { kind: "svn", url: "svn://host/trunk" }, busy: false, onArchive() {}, onUnarchive() {}, onRefresh() {} })));
  assert.doesNotThrow(() => render(createElement(components.CurrentRunCard, { run, last: run })));
  assert.doesNotThrow(() => render(createElement(components.RoadmapCard, { roadmap, plans: roadmap.plans })));
  assert.doesNotThrow(() => render(createElement(components.RunsCard, { runs: [run], loading: false })));
  assert.doesNotThrow(() => render(createElement(components.PlanAutoCard, { execution: null })));
  const execution = { id: 7, status: "running", percent: 60, completed: false, blocked: false, blockTopic: null, startedAt: NOW, endedAt: null, tasks: [{ key: "freeze", title: "需求与范围冻结", status: "ok" }, { key: "design", title: "架构与接口设计", status: "ok" }, { key: "build", title: "开发实现", status: "running" }, { key: "verify", title: "联调与测试", status: "pending" }, { key: "release", title: "发布上线", status: "pending" }] };
  assert.doesNotThrow(() => render(createElement(components.PlanAutoCard, { execution })));
  const companyDraft = { name: "天元数智（测试）有限公司", entityType: "company", shortName: "天元数智", creditCode: "91310000MA1K3XYZ8Q", industry: "软件", employeeCount: "1", taxpayerType: "general", bankName: "示例银行", bankAccount: "6222000000000000", businessScope: "软件开发。" };
  const companyDefaults = { defaultOs: "debian", defaultRemoteMethod: "ssh", defaultAccount: "canetwork", defaultSshPort: 22, resources: [{ id: 1, kind: "code_repo", name: "GitHub 主仓库" }] };
  assert.doesNotThrow(() => render(createElement(components.CompanyProfileCard, { draft: companyDraft, defaults: companyDefaults, loading: false, busy: false, onChange() {}, onSave() {}, onReset() {} })));
  // 必填标记：仅公司全称带红色星号（口径同后端 name required），其余可选字段不标。
  const companyTree = components.CompanyProfileCard({ draft: companyDraft, defaults: companyDefaults, loading: false, busy: false, onChange() {}, onSave() {}, onReset() {} });
  const requiredMarks = collectElements(companyTree, (element) => element.type === "em" && element.props.className === "ocReq");
  assert.equal(requiredMarks.length, 1, "公司信息卡应有且仅有 1 个必填星号");
  assert.equal(requiredMarks[0].props.children, "*");
  const nameLabel = collectElements(companyTree, (element) => element.type === "span" && element.props.className === "ocFieldLabel" && Array.isArray(element.props.children) && element.props.children[0] === "公司全称");
  assert.equal(nameLabel.length, 1, "公司全称标签应存在");
  const marksInNameLabel = (nameLabel[0].props.children as unknown[]).filter((child) => typeof child === "object" && child !== null && (child as ElementNode).type === "em" && (child as ElementNode).props.className === "ocReq");
  assert.equal(marksInNameLabel.length, 1, "必填星号应挂在公司全称标签上");
  assert.doesNotThrow(() => render(createElement(components.CompanyProfileCard, { draft: {}, defaults: {}, loading: true, busy: true, onChange() {}, onSave() {}, onReset() {} })));
  assert.doesNotThrow(() => render(createElement(components.PlanAutoCard, { execution: { ...execution, status: "ok", completed: true, blocked: true, blockTopic: "production_release", percent: 100 } })));
});

test("client.js 自动驾驶页签初始化渲染不抛错", async () => {
  const components = await loadComponents();
  // useState 顺序：filter=active、list 加载态、selected 空、summary 无、repos 无、表单默认、忙态、归档忙态……
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
    false,
    "",
  ]);
  assert.doesNotThrow(() => render(createElement(components.AutopilotTab, { flash() {} })));
});
test("client.js 新建项目独立页可渲染（默认 / 创意解析 / 已创建）", async () => {
  const components = await loadComponents();
  assert.equal(typeof components.NewProjectTab, "function", "缺少组件 NewProjectTab");
  // 默认形态：版本库直建表单 + 右侧流程说明
  resetHooks();
  assert.doesNotThrow(() => render(createElement(components.NewProjectTab, { flash() {}, onOpenProject() {} })));
  // 创意/文档形态：SVN 字段、已上传文档、解析结果与已创建卡片同时渲染
  const analysis = { name: "记账助手", source: "ai", projectType: "software", confidence: 0.8, weeks: 4, scope: "记账", goals: ["目标"], risks: ["风险"], openQuestions: ["问题"] };
  resetHooks([
    "idea",
    { name: "", repositoryUrl: "", branch: "main", kind: "git", revision: "", authRef: "", healthUrl: "", scaffold: true, pipeline: true, deployTest: true },
    false,
    { id: 9, name: "记账助手", status: "autopilot", parts: ["检出 commit abc123"], source: "idea", analysis },
    { idea: "做一个记账小程序", name: "记账助手", repositoryUrl: "svn://host/trunk", branch: "trunk", kind: "svn", revision: "HEAD", authRef: "env:SVN" },
    false,
    [{ name: "需求.md", contentBase64: "" }],
    analysis,
  ]);
  assert.doesNotThrow(() => render(createElement(components.NewProjectTab, { flash() {}, onOpenProject() {} })));
});
