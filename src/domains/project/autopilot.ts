/**
 * 项目自动驾驶（SRS-105 REQ-PRJ-027..030、REQ-PRJ-036）：
 * 新建项目时填写版本库 → 自动检出（Git 浅克隆 / SVN checkout）→ 静态扫描（不执行仓库代码）→
 * 回填项目档案（语言/框架/结构/测试/CI/许可）→ 生成开发/测试/部署计划 →
 * 仅把需要老板裁决的事项（许可、测试基线、CI、生产目标、技术栈歧义）推入裁决队列。
 *
 * 边界：只读仓库文件，不安装依赖、不构建、不运行任何仓库脚本；凭据只接受 env: 引用且不落日志；
 * SVN 检出依赖 subversion ≥1.10（svn checkout / svn info），svn 缺失时降级为裁决；
 * 生产部署仍须人工审批，本服务只生成计划与测试环境登记。
 */
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readdir, readFile, rm, writeFile, stat as fsStat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, extname, join } from "node:path";
import type { Pool } from "../../db/pool.ts";
import type { AuditService } from "../../audit/audit.ts";
import { OpcError, ERR } from "../../platform/errors.ts";
import type { WechatPushService } from "../../notify/wechat.ts";

type Row = Record<string, unknown>;

const exec = promisify(execFile);
const AUTH_REF = /^(env|secret|vault|ssh-agent):[A-Za-z0-9_./-]+$/;
const MAX_FILES = 2000;
const MAX_STRUCTURE = 120;
const SKIP_DIRS = new Set([".git", ".svn", ".hg", "node_modules", "dist", "build", "target", "vendor", "__pycache__", ".next", ".venv", "coverage", "out"]);

const LANG_BY_EXT: Record<string, string> = {
  ".ts": "typescript", ".tsx": "typescript", ".js": "javascript", ".jsx": "javascript", ".mjs": "javascript", ".cjs": "javascript",
  ".py": "python", ".go": "go", ".java": "java", ".kt": "kotlin", ".rs": "rust", ".php": "php", ".rb": "ruby",
  ".cs": "csharp", ".c": "c", ".h": "c", ".cpp": "cpp", ".hpp": "cpp", ".vue": "vue", ".svelte": "svelte",
  ".sql": "sql", ".sh": "shell", ".md": "markdown", ".html": "html", ".css": "css", ".scss": "css", ".yml": "yaml", ".yaml": "yaml",
};

const MANIFEST_NAMES = new Set([
  "package.json", "pnpm-lock.yaml", "package-lock.json", "yarn.lock", "tsconfig.json",
  "pom.xml", "build.gradle", "build.gradle.kts", "settings.gradle", "gradle.properties",
  "requirements.txt", "pyproject.toml", "poetry.lock", "setup.py", "Pipfile",
  "go.mod", "go.sum", "Cargo.toml", "Cargo.lock", "composer.json", "Gemfile",
  "Dockerfile", "docker-compose.yml", "docker-compose.yaml", ".gitlab-ci.yml", "Jenkinsfile", "Makefile", "README.md", "LICENSE", "LICENSE.md",
]);

const FRAMEWORKS: Array<[RegExp, string]> = [
  [/^react$|^react-dom$/, "react"], [/^vue$/, "vue"], [/^next$/, "next"], [/^nuxt$/, "nuxt"],
  [/^@nestjs\/core$/, "nestjs"], [/^express$/, "express"], [/^fastify$/, "fastify"], [/^koa$/, "koa"],
  [/^spring-boot-starter/, "spring-boot"], [/^django$/, "django"], [/^fastapi$/, "fastapi"], [/^flask$/, "flask"],
  [/^gin$|^github\.com\/gin-gonic\/gin$/, "gin"], [/^actix-web$/, "actix"],
];

export interface RepositoryInput {
  url: string;
  branch?: string;
  authRef?: string;
  kind?: string;
  revision?: string;
  name?: string;
}

type VcsKind = "git" | "svn";

function str(value: unknown, field: string, required = true): string | null {
  if (value === undefined || value === null || value === "") {
    if (required) throw new OpcError(ERR.AUTO_INVALID, `${field} 必须是非空字符串`, 400);
    return null;
  }
  if (typeof value !== "string") throw new OpcError(ERR.AUTO_INVALID, `${field} 必须是字符串`, 400);
  return value.trim();
}

/** 版本库类型：显式 kind 优先；svn://、svn+ssh:// 推断 SVN；其余默认 Git（公司主用 SVN 时可显式传 kind）。 */
function repoKind(repo: RepositoryInput): VcsKind {
  if (repo.kind === undefined || repo.kind === null || repo.kind === "") {
    return /^svn(\+ssh)?:\/\//i.test(repo.url) ? "svn" : "git";
  }
  const kind = str(repo.kind, "kind") as string;
  if (kind !== "git" && kind !== "svn") throw new OpcError(ERR.AUTO_INVALID, `kind 取值非法：${kind}`, 400);
  return kind;
}

function repoUrl(value: unknown, kind: VcsKind): string {
  const url = str(value, "repositoryUrl") as string;
  if (kind === "svn") {
    const ok = /^(https?|svn|svn\+ssh|file):\/\/\S+$/i.test(url) || /^\/[^\s]+$/.test(url);
    if (!ok) throw new OpcError(ERR.AUTO_INVALID, `SVN 版本库地址非法（支持 svn://、svn+ssh://、http(s)://、file://、本地路径）：${url.slice(0, 120)}`, 400);
    return url;
  }
  const ok = /^https?:\/\/\S+$/i.test(url) || /^git@[^:\s]+:\S+$/i.test(url) || /^ssh:\/\/\S+$/i.test(url) || /^file:\/\/\S+$/i.test(url) || /^\/[^\s]+$/.test(url);
  if (!ok) throw new OpcError(ERR.AUTO_INVALID, `版本库地址非法（支持 https/ssh/git@/file:///本地路径）：${url.slice(0, 120)}`, 400);
  return url;
}

/** SVN 修订号：HEAD 或数字（可带 r 前缀）；缺省 HEAD。 */
function svnRevision(value: string | undefined): string {
  if (value === undefined || value === null || value === "") return "HEAD";
  const raw = str(value, "revision") as string;
  if (raw.toUpperCase() === "HEAD") return "HEAD";
  const matched = /^r?(\d{1,12})$/i.exec(raw);
  if (matched === null) throw new OpcError(ERR.AUTO_INVALID, `revision 只支持 HEAD 或数字修订号（如 12345 / r12345）：${raw.slice(0, 40)}`, 400);
  return matched[1];
}

/** SVN 主干/分支：相对 URI 片段拼到版本库地址后；绝对 URL（含 scheme）直接使用。 */
function svnCheckoutUrl(url: string, branch: string | null): string {
  if (branch === null || branch.trim() === "") return url;
  const value = branch.trim();
  if (/^(https?|svn|svn\+ssh|file):\/\//i.test(value)) return value;
  return `${url.replace(/\/+$/, "")}/${value.replace(/^\/+/, "")}`;
}

function ciDate(daysFromNow: number): string {
  const date = new Date(Date.now() + daysFromNow * 86_400_000);
  return date.toISOString().slice(0, 10);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export class ProjectAutopilotService {
  private readonly pool: Pool;
  private readonly audit: AuditService;
  private readonly wechat: WechatPushService | undefined;

  constructor(pool: Pool, audit: AuditService, wechat?: WechatPushService) {
    this.pool = pool;
    this.audit = audit;
    this.wechat = wechat;
  }

  private async record(action: string, projectId: number, payload: unknown): Promise<void> {
    await this.audit.record({ actor: "boss", action, result: "ok", objectType: "Project", objectId: String(projectId), payload });
  }

  private async assertProject(projectId: number): Promise<void> {
    const result = await this.pool.query("SELECT 1 FROM biz.project WHERE id = $1", [projectId]);
    if (result.rows.length === 0) throw new OpcError(ERR.AUTO_INVALID, `项目不存在：${projectId}`, 404);
  }

  private workspaceRoot(): string {
    // 默认落在用户目录（根分区），避免 /tmp 这类小分区被克隆撑满；可用 OPC_WORKSPACE_ROOT 覆盖
    return process.env.OPC_WORKSPACE_ROOT?.trim() || join(homedir(), ".opc-workspaces");
  }

  // ---------------------------------------------------------------- 版本库登记

  private async registerRepository(projectId: number, repo: RepositoryInput, kind: VcsKind): Promise<Row> {
    const url = repoUrl(repo.url, kind);
    const name = repo.name?.trim() || url.split("/").filter(Boolean).pop()?.replace(/\.git$/, "") || "repository";
    const authRef = repo.authRef === undefined ? null : str(repo.authRef, "authRef") as string;
    if (authRef !== null && !AUTH_REF.test(authRef)) {
      throw new OpcError(ERR.AUTO_CRED, "authRef 只接受 env:/secret:/vault:/ssh-agent: 引用", 400);
    }
    const existing = await this.pool.query<{ id: string }>(
      "SELECT id FROM ref.code_repository WHERE project_id = $1 AND url = $2 ORDER BY id LIMIT 1",
      [projectId, url],
    );
    if (existing.rows.length > 0) {
      // 重复执行：复用已登记的版本库，不重复建行（已建项目接入自动驾驶时很关键）；kind 以本次入参为准
      await this.pool.query(
        `UPDATE ref.code_repository
         SET sync_status = 'pending', kind = $2, default_ref = COALESCE($3, default_ref), auth_ref = COALESCE($4, auth_ref)
         WHERE id = $1`,
        [Number(existing.rows[0].id), kind, repo.branch ?? null, authRef],
      );
      return { id: existing.rows[0].id, reused: true, kind };
    }
    const inserted = await this.pool.query(
      `INSERT INTO ref.code_repository (project_id, name, kind, url, default_ref, auth_ref, sync_mode, sync_status)
       VALUES ($1,$2,$3,$4,$5,$6,'manual','pending') RETURNING id`,
      [projectId, name.slice(0, 120), kind, url, repo.branch ?? null, authRef],
    );
    return { id: String((inserted.rows[0] as Row).id), reused: false, kind };
  }

  // ---------------------------------------------------------------- 检出

  private async checkout(projectId: number, repositoryId: number, repo: RepositoryInput, kind: VcsKind): Promise<Row> {
    const url = repoUrl(repo.url, kind);
    const branch = repo.branch === undefined ? null : str(repo.branch, "branch") as string;
    const authRef = repo.authRef === undefined ? null : str(repo.authRef, "authRef") as string;
    // 修订号只对 SVN 生效：Git 传 revision 直接 400，避免静默忽略；非法修订号同样在落失败记录前拒绝
    const revision = kind === "svn" ? svnRevision(repo.revision) : null;
    if (kind === "git" && repo.revision !== undefined && repo.revision !== "") {
      throw new OpcError(ERR.AUTO_INVALID, "revision 仅用于 SVN 版本库", 400);
    }
    const root = this.workspaceRoot();
    const dir = join(root, `project-${projectId}-${Date.now()}`);
    await mkdir(root, { recursive: true });

    let askpass: string | null = null;
    const startedAt = new Date();
    try {
      let commitSha: string | null = null;
      let svnRev: string | null = null;
      let checkoutUrl = url;
      if (kind === "svn") {
        const svn = await this.svnCheckout(projectId, repo, branch, revision as string, dir);
        checkoutUrl = svn.url;
        svnRev = svn.revision;
      } else {
        const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_LFS_SKIP_SMUDGE: "1" };
        if (authRef !== null) {
          if (!authRef.startsWith("env:")) throw new OpcError(ERR.AUTO_CRED, "自动检出暂只支持 env: 凭据引用", 400);
          const token = process.env[authRef.slice("env:".length)];
          if (!token) throw new OpcError(ERR.AUTO_CRED, `凭据环境变量未设置：${authRef}`, 400);
          askpass = join(tmpdir(), `opc-askpass-${Date.now()}-${Math.random().toString(36).slice(2)}.sh`);
          await writeFile(askpass, '#!/bin/sh\ncase "$1" in *[Uu]sername*) echo "x-access-token";; *) echo "${OPC_CLONE_TOKEN}";; esac\n', { mode: 0o700 });
          env.GIT_ASKPASS = askpass;
          env.GIT_ASKPASS_REQUIRE = "force";
          env.OPC_CLONE_TOKEN = token;
        }
        await exec("git", ["clone", "--depth", "1", ...(branch === null ? [] : ["--branch", branch]), url, dir], { env, timeout: 120_000, maxBuffer: 8 * 1024 * 1024 });
        const rev = await exec("git", ["-C", dir, "rev-parse", "HEAD"], { timeout: 15_000 });
        commitSha = rev.stdout.trim();
      }
      const measured = await this.measure(dir);
      const row = await this.pool.query(
        `INSERT INTO ref.project_checkout (project_id, repository_id, url, branch, vcs_kind, commit_sha, revision, workspace_path, file_count, size_bytes, status, checked_out_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'ok',$11) RETURNING id`,
        [projectId, repositoryId, checkoutUrl, branch, kind, commitSha, svnRev, dir, measured.files, measured.bytes, startedAt],
      );
      await this.record("project.autopilot.checkout", projectId, { url: checkoutUrl, vcs: kind, branch, commitSha, revision: svnRev, files: measured.files });
      return { id: String((row.rows[0] as Row).id), dir, commitSha, revision: svnRev, branch, files: measured.files, bytes: measured.bytes, status: "ok" };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const detail = message.split("\n").slice(0, 3).join(" ").slice(0, 300);
      await this.pool.query(
        `INSERT INTO ref.project_checkout (project_id, repository_id, url, branch, vcs_kind, status, error, checked_out_at)
         VALUES ($1,$2,$3,$4,$5,'failed',$6,$7)`,
        [projectId, repositoryId, url, branch, kind, `检出失败：${detail}`, startedAt],
      );
      if (error instanceof OpcError) throw error;
      throw new OpcError(ERR.AUTO_CHECKOUT, `检出失败：${detail}`, 502);
    } finally {
      if (askpass !== null) await rm(askpass, { force: true });
    }
  }

  /** SVN 环境：沿用宿主 PATH/HOME/ssh-agent；语言固定 C.UTF-8，保证 svn 输出可解析。 */
  private svnEnv(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
      HOME: process.env.HOME ?? tmpdir(),
      LANG: "C.UTF-8",
      LC_ALL: "C.UTF-8",
    };
    if (process.env.SSH_AUTH_SOCK !== undefined) env.SSH_AUTH_SOCK = process.env.SSH_AUTH_SOCK;
    return env;
  }

  /**
   * 带 stdin 的子进程执行（SVN 口令经 `--password-from-stdin` 传入，不出现在 argv/日志）。
   * 失败时只保留 stderr 末尾三行，避免把大段输出写进调用方。
   */
  private runSvn(args: string[], options: { env: NodeJS.ProcessEnv; timeoutMs: number; stdin?: string }): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn("svn", args, { env: options.env, stdio: ["pipe", "pipe", "pipe"] });
      let stderr = "";
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error(`svn 超时（${Math.round(options.timeoutMs / 1000)}s）`));
      }, options.timeoutMs);
      child.stderr.on("data", (chunk) => { stderr += String(chunk); });
      child.on("error", (error) => { clearTimeout(timer); reject(error); });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(`svn 退出码 ${code}：${stderr.trim().split("\n").slice(-3).join(" ").slice(0, 300)}`));
      });
      if (options.stdin !== undefined) child.stdin.write(options.stdin);
      child.stdin.end();
    });
  }

  /** SVN 检出：subversion ≥1.10；branch 为主干/分支路径或绝对 URL；revision=HEAD|数字。 */
  private async svnCheckout(projectId: number, repo: RepositoryInput, branch: string | null, revision: string, dir: string): Promise<{ url: string; revision: string }> {
    const env = this.svnEnv();
    try {
      await exec("svn", ["--version", "--quiet"], { env, timeout: 15_000 });
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      if (code === "ENOENT") {
        // 降级为裁决：把「检出主机缺 svn」交给老板安排安装，而不是让项目静默失败
        await this.recordDecision(projectId, {
          topic: "svn_client",
          question: "检出主机未安装 svn 客户端（subversion ≥1.10）：安装后才能检出公司 SVN 版本库，是否安排安装？",
          riskLevel: "high",
          options: [
            { label: "安装 subversion", impact: "在检出主机执行 apt-get install subversion（≥1.10）后重试" },
            { label: "改用 Git 镜像", impact: "公司以 SVN 为准，镜像会产生双份维护" },
          ],
          payload: { url: repo.url, vcs: "svn" },
        });
        throw new OpcError(ERR.AUTO_CHECKOUT, "检出失败：检出主机未安装 svn 客户端（subversion ≥1.10），安装后重试", 502);
      }
      const detail = error instanceof Error ? error.message.split("\n")[0].slice(0, 200) : String(error).slice(0, 200);
      throw new OpcError(ERR.AUTO_CHECKOUT, `检出失败：svn 客户端不可用（${detail}）`, 502);
    }
    const checkoutUrl = svnCheckoutUrl(repo.url, branch);
    const args = ["checkout", "--non-interactive", "--no-auth-cache"];
    if (revision !== "HEAD") args.push("--revision", revision);
    let stdin: string | undefined;
    if (repo.authRef !== undefined) {
      if (!repo.authRef.startsWith("env:")) throw new OpcError(ERR.AUTO_CRED, "自动检出暂只支持 env: 凭据引用", 400);
      const token = process.env[repo.authRef.slice("env:".length)];
      if (!token) throw new OpcError(ERR.AUTO_CRED, `凭据环境变量未设置：${repo.authRef}`, 400);
      const username = process.env.OPC_SVN_USERNAME?.trim() || "opc";
      args.push("--username", username, "--password-from-stdin");
      stdin = token;
    }
    args.push(checkoutUrl, dir);
    await this.runSvn(args, { env, timeoutMs: 180_000, stdin });
    const info = await exec("svn", ["info", "--non-interactive", "--show-item", "revision", dir], { env, timeout: 15_000 });
    const actual = info.stdout.trim();
    return { url: checkoutUrl, revision: /^\d+$/.test(actual) ? actual : revision };
  }

  private async measure(dir: string): Promise<{ files: number; bytes: number }> {
    let files = 0;
    let bytes = 0;
    const walk = async (current: string): Promise<void> => {
      if (files >= MAX_FILES) return;
      const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (files >= MAX_FILES) return;
        if (entry.isDirectory()) {
          if (SKIP_DIRS.has(entry.name)) continue;
          await walk(join(current, entry.name));
        } else if (entry.isFile()) {
          files += 1;
          const info = await fsStat(join(current, entry.name)).catch(() => null);
          if (info !== null) bytes += info.size;
        }
      }
    };
    await walk(dir);
    return { files, bytes };
  }

  // ---------------------------------------------------------------- 静态扫描

  private async scan(dir: string): Promise<Row> {
    const languages: Record<string, number> = {};
    const manifests: string[] = [];
    const tests: string[] = [];
    const ci: string[] = [];
    const structure: string[] = [];
    let loc = 0;
    let fileCount = 0;

    const walk = async (current: string): Promise<void> => {
      if (fileCount >= MAX_FILES) return;
      const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (fileCount >= MAX_FILES) return;
        const full = join(current, entry.name);
        const rel = full.slice(dir.length + 1);
        if (entry.isDirectory()) {
          if (SKIP_DIRS.has(entry.name)) continue;
          if (["test", "tests", "spec", "__tests__", "integration"].includes(entry.name)) tests.push(rel);
          if (rel.split("/").length <= 2) structure.push(rel);
          await walk(full);
          continue;
        }
        if (!entry.isFile()) continue;
        fileCount += 1;
        const ext = extname(entry.name).toLowerCase();
        if (LANG_BY_EXT[ext] !== undefined) languages[LANG_BY_EXT[ext]] = (languages[LANG_BY_EXT[ext]] ?? 0) + 1;
        if (MANIFEST_NAMES.has(entry.name)) manifests.push(rel);
        if (/\.(test|spec)\.(js|ts|jsx|tsx|mjs|py|go|java|rs)$/.test(entry.name)) tests.push(rel);
        if (rel.startsWith(".github/workflows/") || /^(.gitlab-ci.yml|Jenkinsfile)$/.test(entry.name)) ci.push(rel);
        if (["js", "ts", "py", "go", "java", "rs", "php", "rb", "c", "cpp", "vue", "svelte"].some((lang) => LANG_BY_EXT[ext] === lang)) {
          const text = await readFile(full, "utf8").catch(() => "");
          loc += text.split("\n").length;
        }
      }
    };
    await walk(dir);

    const stack = await this.detectStack(dir, manifests, languages);
    return { languages, manifests, structure: structure.slice(0, MAX_STRUCTURE), tests: [...new Set(tests)].slice(0, 200), ci, stack, loc, fileCount };
  }

  private async detectStack(dir: string, manifests: string[], languages: Record<string, number>): Promise<Row> {
    const sorted = Object.entries(languages).sort((a, b) => b[1] - a[1]);
    const primary = sorted.length === 0 ? null : sorted[0][0];
    const frameworks: string[] = [];
    let packageManager: string | null = null;
    if (manifests.includes("pnpm-lock.yaml")) packageManager = "pnpm";
    else if (manifests.includes("yarn.lock")) packageManager = "yarn";
    else if (manifests.includes("package-lock.json") || manifests.includes("package.json")) packageManager = "npm";

    if (manifests.includes("package.json")) {
      const raw = await readFile(join(dir, "package.json"), "utf8").catch(() => "");
      try {
        const pkg = JSON.parse(raw) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
        const deps = Object.keys({ ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) });
        for (const [pattern, name] of FRAMEWORKS) if (deps.some((dep) => pattern.test(dep))) frameworks.push(name);
      } catch { /* 解析失败不阻断扫描 */ }
    }
    if (manifests.includes("pom.xml") || manifests.includes("build.gradle") || manifests.includes("build.gradle.kts")) frameworks.push("jvm");
    if (manifests.includes("pyproject.toml") || manifests.includes("requirements.txt")) frameworks.push("python");
    if (manifests.includes("go.mod")) frameworks.push("go");
    if (manifests.includes("Cargo.toml")) frameworks.push("rust");
    return { frameworks: [...new Set(frameworks)], packageManager, primary };
  }

  // ---------------------------------------------------------------- 回填档案与计划

  private async applyProfile(projectId: number, repo: RepositoryInput, checkout: Row, scan: Row, kind: VcsKind): Promise<void> {
    const techStack = { primaryLanguage: (scan.stack as Row).primary ?? null, languages: scan.languages, frameworks: (scan.stack as Row).frameworks, packageManager: (scan.stack as Row).packageManager };
    const softwareProfile = {
      repositoryUrl: repo.url,
      vcs: kind,
      branch: checkout.branch ?? null,
      commit: checkout.commitSha ?? null,
      revision: checkout.revision ?? null,
      files: checkout.files,
      bytes: checkout.bytes,
      loc: scan.loc,
      manifests: scan.manifests,
      tests: scan.tests,
      ci: scan.ci,
      scannerVersion: "autopilot-1",
      scannedAt: new Date().toISOString(),
    };
    await this.pool.query(
      `UPDATE biz.project
       SET project_type = 'software',
           tech_stack = $2::jsonb,
           software_profile = $3::jsonb,
           stage = CASE WHEN stage IS NULL OR stage = '' THEN 'planning' ELSE stage END
       WHERE id = $1`,
      [projectId, JSON.stringify(techStack), JSON.stringify(softwareProfile)],
    );
  }

  private async generatePlans(projectId: number, repo: RepositoryInput, scan: Row): Promise<Row[]> {
    const loc = Number(scan.loc ?? 0);
    const weeks = clamp(Math.ceil(loc / 3000) + 1, 2, 12);
    const hasTests = (scan.tests as string[]).length > 0;
    const hasCi = (scan.ci as string[]).length > 0;
    const created: Row[] = [];

    // 1) 开发计划：里程碑 + 计划文档
    const milestones = [
      { name: "需求与范围冻结", day: 3 },
      { name: "架构与接口设计", day: 3 + Math.ceil(weeks * 0.25) * 7 },
      { name: "开发实现", day: 3 + Math.ceil(weeks * 0.7) * 7 },
      { name: "联调与测试", day: 3 + Math.ceil(weeks * 0.9) * 7 },
      { name: "发布上线", day: 3 + weeks * 7 },
    ];
    const existingMilestones = await this.pool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM biz.project_milestone WHERE project_id = $1",
      [projectId],
    );
    const milestonesReused = (existingMilestones.rows[0]?.n ?? 0) > 0;
    if (!milestonesReused) {
      for (const item of milestones) {
        await this.pool.query(
          `INSERT INTO biz.project_milestone (project_id, name, stage, target_date, status, owner, evidence)
           VALUES ($1,$2,$3,$4,'planned',$5,$6)`,
          [projectId, item.name, "plan", ciDate(item.day), "项目监理", "autopilot-1 自动生成"],
        );
      }
    }
    const devContent = {
      weeks,
      milestones: milestones.map((item) => ({ name: item.name, targetDate: ciDate(item.day) })),
      milestonesReused,
      workBreakdown: ["需求澄清", "架构设计", "接口契约", "编码实现", "代码评审", "联调", "测试回归", "发布"],
      assumptions: [`代码规模约 ${loc} 行`, hasTests ? "仓库已有测试目录" : "仓库未发现测试，先建测试基线", hasCi ? "仓库已有 CI 配置" : "仓库未发现 CI，需接入"],
    };
    created.push(await this.insertPlan(projectId, "dev", "开发计划（自动生成）", devContent));

    // 2) 测试计划：test_plan + 基线用例 + 计划文档
    const existingPlan = await this.pool.query<{ id: string }>(
      "SELECT id FROM biz.test_plan WHERE project_id = $1 ORDER BY id LIMIT 1",
      [projectId],
    );
    let planId: string;
    if (existingPlan.rows.length > 0) {
      planId = String(existingPlan.rows[0].id);
    } else {
      const plan = await this.pool.query(
        `INSERT INTO biz.test_plan (project_id, version, scope, test_types, entry_criteria, exit_criteria, owner, status)
         VALUES ($1,'0.1.0','自动生成基线',$2::jsonb,'构建与静态检查通过','P0/P1 全通过且无阻塞缺陷','项目监理','draft') RETURNING id`,
        [projectId, JSON.stringify(hasTests ? ["unit", "integration"] : ["api"])],
      );
      planId = String((plan.rows[0] as Row).id);
    }
    const existingCases = await this.pool.query<{ case_code: string }>("SELECT case_code FROM biz.test_case WHERE project_id = $1", [projectId]);
    const knownCases = new Set(existingCases.rows.map((row) => row.case_code));
    const cases = [
      { code: "TC-AUTO-001", title: "构建冒烟", steps: ["检出代码", "安装依赖", "构建"] },
      { code: "TC-AUTO-002", title: "自动化测试", steps: ["运行仓库既有测试", "记录通过率"] },
      { code: "TC-AUTO-003", title: "部署验证", steps: ["部署到测试环境", "健康检查", "核心接口冒烟"] },
    ];
    for (const item of cases) {
      if (knownCases.has(item.code)) continue;
      await this.pool.query(
        `INSERT INTO biz.test_case (project_id, plan_id, case_code, title, preconditions, steps, expected, priority, kind, version, status)
         VALUES ($1,$2,$3,$4,'仓库已检出',$5::jsonb,$6,'P1','auto','0.1.0','draft')`,
        [projectId, planId, item.code, item.title, JSON.stringify(item.steps), "全部通过"],
      );
      knownCases.add(item.code);
    }
    const testContent = { planId, cases: cases.map((item) => item.code), testTypes: hasTests ? ["unit", "integration"] : ["api"], entryCriteria: "构建与静态检查通过", exitCriteria: "P0/P1 全通过且无阻塞缺陷" };
    created.push(await this.insertPlan(projectId, "test", "测试计划（自动生成）", testContent));

    // 3) 部署计划：优先复用公司默认测试服务器，生产目标留给老板裁决
    const server = await this.pool.query<{ id: string; name: string; endpoint: string; default_account: string | null; credential_ref: string | null }>(
      `SELECT id, name, endpoint, default_account, credential_ref
       FROM ref.shared_resource WHERE kind = 'test_server' AND is_default AND status = 'active' ORDER BY id LIMIT 1`,
    );
    const existingEnv = await this.pool.query<{ id: string }>(
      "SELECT id FROM ref.deploy_environment WHERE project_id = $1 AND env_type = 'test' ORDER BY id LIMIT 1",
      [projectId],
    );
    let environmentId: string | null = existingEnv.rows.length > 0 ? String(existingEnv.rows[0].id) : null;
    if (environmentId === null && server.rows.length > 0) {
      const target = server.rows[0];
      const env = await this.pool.query(
        `INSERT INTO ref.deploy_environment (project_id, env_type, name, host, port, ssh_user, auth_ref, approval_policy, status)
         VALUES ($1,'test','测试环境（自动）',$2,22,$3,$4,'manual','active') RETURNING id`,
        [projectId, target.endpoint, target.default_account ?? "canetwork", target.credential_ref],
      );
      environmentId = String((env.rows[0] as Row).id);
    }
    const deployContent = {
      environmentId,
      environmentSource: server.rows.length > 0 ? server.rows[0].name : null,
      targets: [
        { name: "test", strategy: "ssh", approval: "manual" },
        { name: "prod", strategy: "ssh", approval: "manual", status: "waiting-for-decision" },
      ],
      steps: ["检出并构建制品", "部署到测试环境", "执行冒烟测试", "老板确认后发布生产", "失败回滚上一版本"],
      rollback: "保留上一版本制品与配置快照；失败回滚并记录发布单",
      secrets: "凭据仅引用 env:/ssh-agent:，不在计划中落地明文",
    };
    created.push(await this.insertPlan(projectId, "deploy", "部署计划（自动生成）", deployContent));
    return created;
  }

  private async insertPlan(projectId: number, kind: string, title: string, content: Row): Promise<Row> {
    // 重复执行时递增版本（UNIQUE(project_id, plan_kind, version)），保留历史计划
    const next = await this.pool.query<{ version: number }>(
      "SELECT coalesce(max(version), 0) + 1 AS version FROM stat.project_plan WHERE project_id = $1 AND plan_kind = $2",
      [projectId, kind],
    );
    const version = Number(next.rows[0]?.version ?? 1);
    const result = await this.pool.query(
      `INSERT INTO stat.project_plan (project_id, plan_kind, version, title, content, status)
       VALUES ($1,$2,$3,$4,$5::jsonb,'draft') RETURNING id, plan_kind, version, title, status`,
      [projectId, kind, version, title, JSON.stringify(content)],
    );
    return result.rows[0] as Row;
  }

  // ---------------------------------------------------------------- 裁决队列

  private async createDecisions(projectId: number, repo: RepositoryInput, scan: Row, extra: Row = {}): Promise<Row[]> {
    const findings: Array<{ topic: string; question: string; riskLevel: string; options: Array<{ label: string; impact: string }>; payload?: Row }> = [];
    const manifests = scan.manifests as string[];
    const hasLicense = manifests.some((item) => item === "LICENSE" || item === "LICENSE.md");
    const hasTests = (scan.tests as string[]).length > 0;
    const hasCi = (scan.ci as string[]).length > 0;
    const languages = Object.entries(scan.languages as Record<string, number>).sort((a, b) => b[1] - a[1]);
    const hasManifest = manifests.some((item) => !["README.md", "LICENSE", "LICENSE.md"].includes(item));

    if (!hasLicense) findings.push({ topic: "license", riskLevel: "medium", question: "仓库未发现 LICENSE：该项目按开源还是商用口径管理？", options: [{ label: "商用专有", impact: "对外发布与外包协作需法务口径" }, { label: "开源许可", impact: "需确认许可类型与传染性" }] });
    if (!hasTests) findings.push({ topic: "test_baseline", riskLevel: "medium", question: "仓库未发现自动化测试：先补测试基线还是按手工验收推进？", options: [{ label: "先补测试基线", impact: "开发计划前置 1 周" }, { label: "手工验收先行", impact: "验收风险由老板承担" }] });
    if (!hasCi) findings.push({ topic: "ci", riskLevel: "low", question: "仓库未发现 CI 配置：是否接入自动构建与测试流水线？", options: [{ label: "接入 CI", impact: "增加流水线维护成本" }, { label: "暂不接入", impact: "回归依赖人工执行" }] });
    if (!hasManifest) findings.push({ topic: "stack_missing", riskLevel: "high", question: "仓库未识别到包管理/构建清单：技术栈口径需要老板确认。", options: [{ label: "人工指定技术栈", impact: "需补一份架构说明" }, { label: "暂缓生成计划", impact: "项目保持 draft" }] });
    if (languages.length >= 3 && languages[1][1] * 4 >= languages[0][1]) {
      findings.push({ topic: "stack_ambiguous", riskLevel: "low", question: `仓库主语言不唯一（${languages.slice(0, 3).map(([name, n]) => `${name}:${n}`).join(" / ")}）：以哪条技术栈为主线？`, options: [{ label: languages[0][0], impact: "主语言优先" }, { label: languages[1][0], impact: "按团队熟悉度调整" }] });
    }
    const prod = await this.pool.query("SELECT 1 FROM ref.shared_resource WHERE kind = 'public_server' AND status = 'active' LIMIT 1");
    if (prod.rows.length === 0) findings.push({ topic: "deploy_target", riskLevel: "high", question: "尚未登记可用的公网/生产服务器：生产部署目标待老板裁决。", options: [{ label: "登记生产服务器", impact: "补齐 ref.shared_resource 后方可发布" }, { label: "先只上测试环境", impact: "发布延后" }] });

    const scaffold = (extra.scaffold ?? undefined) as Row | undefined;
    const pipeline = (extra.pipeline ?? undefined) as Row | undefined;
    const deploy = (extra.deploy ?? undefined) as Row | undefined;
    if (scaffold !== undefined && scaffold.status === "committed") {
      findings.push({ topic: "scaffold_review", riskLevel: "low", question: "自动驾驶已生成本地分支骨架，是否合并为项目基线？", options: [{ label: "合并骨架", impact: "补全目录与冒烟用例" }, { label: "丢弃骨架", impact: "保持仓库原样" }] });
    }
    if (pipeline !== undefined && pipeline.status === "failed") {
      findings.push({ topic: "pipeline_failed", riskLevel: "high", question: "自动测试流水线未通过：先修代码还是调整流水线？", options: [{ label: "修复后重跑", impact: "阻塞发布" }, { label: "调整为人工验收", impact: "风险由老板承担" }] });
    }
    if (deploy !== undefined && deploy.status === "pending") {
      findings.push({ topic: "deploy_executor", riskLevel: "high", question: "测试环境发布未配置执行命令：如何自动发布？", options: [{ label: "配置 OPC_TEST_DEPLOY_CMD", impact: "后续自动发布测试环境" }, { label: "人工发布", impact: "自动化止步于发布单" }] });
    }
    if (deploy !== undefined && deploy.status === "failed") {
      findings.push({ topic: "deploy_failed", riskLevel: "high", question: "测试环境发布失败：回滚还是修复后重发？", options: [{ label: "修复后重发", impact: "保留发布单记录" }, { label: "回滚上一版本", impact: "按部署计划回滚" }] });
    }
    const existingDecisions = await this.pool.query<{ topic: string }>(
      "SELECT topic FROM stat.project_decision WHERE project_id = $1",
      [projectId],
    );
    const askedTopics = new Set(existingDecisions.rows.map((row) => row.topic));
    const created: Row[] = [];
    for (const item of findings) {
      if (askedTopics.has(item.topic)) continue;
      askedTopics.add(item.topic);
      const result = await this.pool.query(
        `INSERT INTO stat.project_decision (project_id, topic, question, options, risk_level, status, payload)
         VALUES ($1,$2,$3,$4::jsonb,$5,'pending',$6::jsonb) RETURNING id, topic, question, risk_level, status`,
        [projectId, item.topic, item.question, JSON.stringify(item.options), item.riskLevel, JSON.stringify({ repository: repo.url, scan: { manifests, hasTests, hasCi } })],
      );
      const decisionRow = result.rows[0] as Row;
      created.push(decisionRow);
      if (this.wechat !== undefined) await this.wechat.enqueueDecision(projectId, decisionRow).catch(() => undefined);
    }
    if (created.length > 0) await this.record("project.autopilot.decisions", projectId, { count: created.length, topics: created.map((item) => item.topic) });
    return created;
  }

  // ---------------------------------------------------------------- 代码骨架

  private async scaffoldTemplates(scan: Row): Promise<Array<{ path: string; content: string }>> {
    const manifests = scan.manifests as string[];
    const node = manifests.includes("package.json");
    const python = manifests.includes("pyproject.toml") || manifests.includes("requirements.txt");
    if (node) {
      return [
        { path: "src/index.js", content: "// 由 OPC 自动驾驶生成的骨架入口\nfunction main() {\n  console.log(\"hello from opc scaffold\");\n}\n\nmain();\n" },
        { path: "test/smoke.test.js", content: "import assert from 'node:assert';\nimport test from 'node:test';\n\ntest('smoke', () => { assert.ok(true); });\n" },
        { path: ".gitignore", content: "node_modules/\ndist/\ncoverage/\n.env\n" },
        { path: "Dockerfile", content: "FROM node:24-alpine\nWORKDIR /app\nCOPY . .\nCMD [\"node\", \"src/index.js\"]\n" },
      ];
    }
    if (python) {
      return [
        { path: "src/main.py", content: "def main() -> None:\n    print(\"hello from opc scaffold\")\n\n\nif __name__ == \"__main__\":\n    main()\n" },
        { path: "tests/test_smoke.py", content: "def test_smoke() -> None:\n    assert True\n" },
        { path: ".gitignore", content: "__pycache__/\n.venv/\n.env\n" },
      ];
    }
    return [];
  }

  /** 只在缺失时补骨架；Git 生成后提交到本地分支（不推送远端），SVN 只落工作副本不提交（不写远端）。 */
  private async generateScaffold(projectId: number, checkoutId: number, dir: string, scan: Row, kind: VcsKind): Promise<Row> {
    const templates = await this.scaffoldTemplates(scan);
    const created: string[] = [];
    const skipped: string[] = [];
    for (const item of templates) {
      const full = join(dir, item.path);
      const exists = await fsStat(full).then(() => true).catch(() => false);
      if (exists) {
        skipped.push(item.path);
        continue;
      }
      await mkdir(dirname(full), { recursive: true });
      await writeFile(full, item.content);
      created.push(item.path);
    }
    let status = created.length === 0 ? "skipped" : "generated";
    let branch: string | null = null;
    let error: string | null = null;
    if (created.length > 0 && kind === "svn") {
      // SVN 没有本地分支提交语义：骨架只落工作副本，提交/合入由人工走公司 SVN 流程，故不产生 scaffold_review 裁决
      status = "generated";
    } else if (created.length > 0) {
      branch = `opc/autopilot-${Date.now()}`;
      try {
        await exec("git", ["-C", dir, "checkout", "-q", "-b", branch]);
        await exec("git", ["-C", dir, "add", ...created]);
        await exec("git", ["-C", dir, "-c", "user.name=opc-autopilot", "-c", "user.email=autopilot@opc.local", "commit", "-q", "-m", "chore(autopilot): 生成代码骨架"]);
        status = "committed";
      } catch (err) {
        error = (err instanceof Error ? err.message : String(err)).split("\n")[0].slice(0, 300);
      }
    }
    const row = await this.pool.query(
      `INSERT INTO stat.project_scaffold (project_id, checkout_id, branch, files, status, error)
       VALUES ($1,$2,$3,$4::jsonb,$5,$6) RETURNING id, branch, files, status, error`,
      [projectId, checkoutId, branch, JSON.stringify({ created, skipped, vcs: kind }), status, error],
    );
    await this.record("project.autopilot.scaffold", projectId, { created, skipped, status, branch, vcs: kind });
    return { id: String((row.rows[0] as Row).id), branch, files: { created, skipped }, status, error };
  }

  // ---------------------------------------------------------------- 测试流水线

  private async pipelineSteps(scan: Row, dir: string): Promise<Array<{ stage: string; command: string; args: string[] }>> {
    const manifests = scan.manifests as string[];
    const steps: Array<{ stage: string; command: string; args: string[] }> = [];
    if (manifests.includes("package.json")) {
      const raw = await readFile(join(dir, "package.json"), "utf8").catch(() => "");
      try {
        const pkg = JSON.parse(raw) as { scripts?: Record<string, string> };
        const scripts = pkg.scripts ?? {};
        if (scripts.lint !== undefined) steps.push({ stage: "lint", command: "npm", args: ["run", "lint", "--silent"] });
        if (scripts.build !== undefined) steps.push({ stage: "build", command: "npm", args: ["run", "build", "--silent"] });
        if (scripts.test !== undefined) steps.push({ stage: "test", command: "npm", args: ["test", "--silent"] });
      } catch { /* 清单损坏时跳过 node 步骤 */ }
    }
    if (manifests.includes("go.mod")) steps.push({ stage: "test", command: "go", args: ["test", "./..."] });
    if (manifests.includes("pyproject.toml") || manifests.includes("requirements.txt")) steps.push({ stage: "test", command: "python3", args: ["-m", "pytest", "-q"] });
    return steps.slice(0, 3);
  }

  private async runPipelineStep(projectId: number, checkoutId: number, dir: string, step: { stage: string; command: string; args: string[] }): Promise<Row> {
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
      HOME: process.env.HOME ?? dir,
      LANG: "C.UTF-8",
      CI: "1",
    };
    const started = Date.now();
    const commandText = `${step.command} ${step.args.join(" ")}`;
    try {
      const out = await exec(step.command, step.args, { cwd: dir, timeout: 300_000, maxBuffer: 4 * 1024 * 1024, env });
      const row = await this.pool.query(
        `INSERT INTO stat.project_pipeline_run (project_id, checkout_id, stage, command, exit_code, status, log_tail, duration_ms)
         VALUES ($1,$2,$3,$4,0,'ok',$5,$6) RETURNING id, stage, command, status, exit_code`,
        [projectId, checkoutId, step.stage, commandText, `${out.stdout}\n${out.stderr}`.trim().slice(-2000), Date.now() - started],
      );
      return row.rows[0] as Row;
    } catch (err) {
      const detail = (err instanceof Error ? err.message : String(err)).slice(-2000);
      const row = await this.pool.query(
        `INSERT INTO stat.project_pipeline_run (project_id, checkout_id, stage, command, exit_code, status, log_tail, duration_ms)
         VALUES ($1,$2,$3,$4,$5,'failed',$6,$7) RETURNING id, stage, command, status, exit_code`,
        [projectId, checkoutId, step.stage, commandText, typeof (err as { code?: number }).code === "number" ? (err as { code?: number }).code : null, detail, Date.now() - started],
      );
      return row.rows[0] as Row;
    }
  }

  private async runPipeline(projectId: number, checkoutId: number, dir: string, scan: Row, options: Row): Promise<Row> {
    const runs: Row[] = [];
    const steps = await this.pipelineSteps(scan, dir);
    if (steps.length === 0) {
      const row = await this.pool.query(
        `INSERT INTO stat.project_pipeline_run (project_id, checkout_id, stage, command, status, log_tail)
         VALUES ($1,$2,'other','（无可用测试/构建脚本）','skipped','未识别到可执行的构建或测试脚本') RETURNING id, stage, command, status`,
        [projectId, checkoutId],
      );
      await this.record("project.autopilot.pipeline", projectId, { status: "skipped" });
      return { status: "skipped", runs: [row.rows[0]] };
    }
    if (options.install === true && (scan.manifests as string[]).includes("package.json")) {
      runs.push(await this.runPipelineStep(projectId, checkoutId, dir, { stage: "install", command: "npm", args: ["install", "--ignore-scripts", "--no-audit", "--no-fund"] }));
    }
    for (const step of steps) runs.push(await this.runPipelineStep(projectId, checkoutId, dir, step));
    const status = runs.some((run) => run.status === "failed" || run.status === "pending") ? "failed" : "ok";
    await this.record("project.autopilot.pipeline", projectId, { status, runs: runs.map((run) => ({ stage: run.stage, status: run.status })) });
    return { status, runs };
  }

  // ---------------------------------------------------------------- 发布测试环境

  private deployEnv(): NodeJS.ProcessEnv {
    return {
      PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
      HOME: process.env.HOME ?? "/tmp",
      LANG: "C.UTF-8",
    };
  }

  async deployTestEnvironment(projectId: number, input: Row = {}): Promise<Row> {
    await this.assertProject(projectId);
    const env = await this.pool.query<{ id: string; name: string; host: string }>(
      "SELECT id, name, host FROM ref.deploy_environment WHERE project_id = $1 AND env_type = 'test' ORDER BY id DESC LIMIT 1",
      [projectId],
    );
    if (env.rows.length === 0) throw new OpcError(ERR.AUTO_INVALID, "项目还没有测试环境：先执行自动驾驶生成部署计划", 400);
    const envId = env.rows[0].id;
    const checkout = await this.pool.query<{ commit_sha: string | null; revision: string | null }>(
      "SELECT commit_sha, revision FROM ref.project_checkout WHERE project_id = $1 ORDER BY id DESC LIMIT 1",
      [projectId],
    );
    // 发布版本号：Git 取 commit SHA 前 12 位，SVN 取修订号；都缺失时兜底 0
    const version = typeof input.version === "string" ? input.version : String(checkout.rows[0]?.commit_sha ?? checkout.rows[0]?.revision ?? "0").slice(0, 12);
    const release = await this.pool.query(
      `INSERT INTO biz.release_order (project_id, environment_id, version, change_note, rollback_version, requested_by, approved_by, status)
       VALUES ($1,$2,$3,'autopilot 自动发布到测试环境','previous','autopilot:test','autopilot:test','approved') RETURNING id`,
      [projectId, Number(envId), version],
    );
    const releaseId = Number((release.rows[0] as Row).id);
    const command = typeof input.command === "string" && input.command.trim() !== "" ? input.command : (process.env.OPC_TEST_DEPLOY_CMD?.trim() || null);
    const healthUrl = typeof input.healthUrl === "string" && input.healthUrl.trim() !== "" ? input.healthUrl : (process.env.OPC_TEST_DEPLOY_HEALTH_URL?.trim() || null);
    const started = new Date();
    let exitCode: number | null = null;
    let status = "pending";
    let log = command === null ? "未配置部署命令（OPC_TEST_DEPLOY_CMD 或 command），已转裁决等待执行方式" : "";
    if (command !== null) {
      try {
        const out = await exec("bash", ["-c", command], { cwd: this.workspaceRoot(), timeout: 300_000, maxBuffer: 4 * 1024 * 1024, env: this.deployEnv() });
        status = "ok";
        exitCode = 0;
        log = `${out.stdout}\n${out.stderr}`.trim().slice(-2000);
      } catch (err) {
        status = "failed";
        const code = (err as { code?: number }).code;
        exitCode = typeof code === "number" ? code : null;
        log = (err instanceof Error ? err.message : String(err)).slice(-2000);
      }
      if (status === "ok" && healthUrl !== null) {
        try {
          const response = await fetch(healthUrl, { signal: AbortSignal.timeout(10_000) });
          if (!response.ok) status = "failed";
          log = `${log}\n[health] ${healthUrl} -> ${response.status}`.slice(-2000);
        } catch (err) {
          status = "failed";
          log = `${log}\n[health] ${healthUrl} 不可达：${err instanceof Error ? err.message : String(err)}`.slice(-2000);
        }
      }
      await this.pool.query(
        "UPDATE biz.release_order SET executed_at = now(), health_check = $2::jsonb WHERE id = $1",
        [releaseId, JSON.stringify({ status, healthUrl })],
      );
    }
    const row = await this.pool.query(
      `INSERT INTO stat.project_deploy_run (project_id, release_id, environment_id, command, health_url, exit_code, status, log_tail, started_at, ended_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id, status, exit_code, release_id, command, health_url`,
      [projectId, releaseId, Number(envId), command, healthUrl, exitCode, status, log, started, new Date()],
    );
    await this.record("project.autopilot.deploy-test", projectId, { releaseId, environmentId: envId, status, exitCode });
    return { id: String((row.rows[0] as Row).id), releaseId, environmentId: envId, status, exitCode, healthUrl, logTail: log.slice(-500) };
  }

  // ---------------------------------------------------------------- 对外入口

  async bootstrap(projectId: number, repo: RepositoryInput, options: Row = {}): Promise<Row> {
    await this.assertProject(projectId);
    if (repo === undefined || repo === null || typeof repo.url !== "string") {
      throw new OpcError(ERR.AUTO_INVALID, "repositoryUrl 必须提供", 400);
    }
    // 先完成入参校验，再登记/检出：非法地址、git 误传 revision、非法修订号都不产生脏记录
    const kind = repoKind(repo);
    repoUrl(repo.url, kind);
    if (kind === "svn") svnRevision(repo.revision);
    if (kind === "git" && repo.revision !== undefined && repo.revision !== "") {
      throw new OpcError(ERR.AUTO_INVALID, "revision 仅用于 SVN 版本库", 400);
    }
    const registered = await this.registerRepository(projectId, repo, kind);
    const checkout = await this.checkout(projectId, Number(registered.id), repo, kind);
    const scan = await this.scan(String(checkout.dir));
    await this.applyProfile(projectId, repo, checkout, scan, kind);
    const checkoutId = Number(checkout.id);
    const scaffold = options.scaffold === false ? null : await this.generateScaffold(projectId, checkoutId, String(checkout.dir), scan, kind);
    const pipeline = options.pipeline === false ? null : await this.runPipeline(projectId, checkoutId, String(checkout.dir), scan, options);
    const plans = await this.generatePlans(projectId, repo, scan);
    const deploy = options.deployTest === false ? null : await this.deployTestEnvironment(projectId, { healthUrl: options.healthUrl });
    const decisions = await this.createDecisions(projectId, repo, scan, { scaffold, pipeline, deploy });
    await this.pool.query(
      `INSERT INTO stat.project_scan (project_id, checkout_id, languages, manifests, structure, tests, ci, findings, status)
       VALUES ($1,$2,$3::jsonb,$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb,'ok')`,
      [projectId, Number(checkout.id), JSON.stringify(scan.languages), JSON.stringify(scan.manifests), JSON.stringify(scan.structure), JSON.stringify(scan.tests), JSON.stringify(scan.ci), JSON.stringify({ stack: scan.stack, loc: scan.loc, fileCount: scan.fileCount })],
    );
    return {
      projectId,
      repository: { id: registered.id, url: repo.url, kind, branch: checkout.branch, reused: registered.reused === true },
      checkout: { vcs: kind, commit: checkout.commitSha ?? null, revision: checkout.revision ?? null, files: checkout.files, bytes: checkout.bytes, status: checkout.status },
      scan: { languages: scan.languages, frameworks: (scan.stack as Row).frameworks, packageManager: (scan.stack as Row).packageManager, tests: scan.tests, ci: scan.ci, loc: scan.loc },
      scaffold,
      pipeline,
      plans,
      deploy,
      decisions,
      readyForProduction: false,
    };
  }

  async summary(projectId: number): Promise<Row> {
    await this.assertProject(projectId);
    const [checkout, scan, plans, decisions, project, scaffold, pipeline, deploy] = await Promise.all([
      this.pool.query("SELECT * FROM ref.project_checkout WHERE project_id = $1 ORDER BY id DESC LIMIT 1", [projectId]),
      this.pool.query("SELECT * FROM stat.project_scan WHERE project_id = $1 ORDER BY id DESC LIMIT 1", [projectId]),
      this.pool.query("SELECT id, plan_kind, version, title, status, generated_at FROM stat.project_plan WHERE project_id = $1 ORDER BY id", [projectId]),
      this.pool.query("SELECT id, topic, question, risk_level, status, decision, decided_by, decided_at FROM stat.project_decision WHERE project_id = $1 ORDER BY id", [projectId]),
      this.pool.query("SELECT tech_stack, software_profile FROM biz.project WHERE id = $1", [projectId]),
      this.pool.query("SELECT * FROM stat.project_scaffold WHERE project_id = $1 ORDER BY id DESC LIMIT 1", [projectId]),
      this.pool.query("SELECT * FROM stat.project_pipeline_run WHERE project_id = $1 ORDER BY id DESC LIMIT 10", [projectId]),
      this.pool.query("SELECT * FROM stat.project_deploy_run WHERE project_id = $1 ORDER BY id DESC LIMIT 5", [projectId]),
    ]);
    return {
      projectId,
      checkout: checkout.rows[0] ?? null,
      scan: scan.rows[0] ?? null,
      plans: plans.rows,
      decisions: decisions.rows,
      pendingDecisions: (decisions.rows as Array<{ status: string }>).filter((item) => item.status === "pending").length,
      profile: project.rows[0] ?? null,
      scaffold: scaffold.rows[0] ?? null,
      pipeline: pipeline.rows,
      deploy: deploy.rows,
    };
  }

  /** 供其他服务登记单条裁决（如创意项目缺版本库）。同项目同 topic 只登记一次。 */
  async recordDecision(projectId: number, input: { topic: string; question: string; options?: Array<{ label: string; impact: string }>; riskLevel?: string; payload?: Row }): Promise<Row> {
    await this.assertProject(projectId);
    const existing = await this.pool.query("SELECT * FROM stat.project_decision WHERE project_id = $1 AND topic = $2 LIMIT 1", [projectId, input.topic]);
    if (existing.rows.length > 0) return existing.rows[0] as Row;
    const result = await this.pool.query(
      `INSERT INTO stat.project_decision (project_id, topic, question, options, risk_level, status, payload)
       VALUES ($1,$2,$3,$4::jsonb,$5,'pending',$6::jsonb) RETURNING *`,
      [projectId, input.topic.slice(0, 32), input.question.slice(0, 1000), JSON.stringify(input.options ?? []), input.riskLevel ?? "medium", JSON.stringify(input.payload ?? {})],
    );
    await this.record("project.decision.record", projectId, { topic: input.topic, riskLevel: input.riskLevel ?? "medium" });
    const row = result.rows[0] as Row;
    if (this.wechat !== undefined) await this.wechat.enqueueDecision(projectId, row).catch(() => undefined);
    return row;
  }

  async listPlans(projectId: number): Promise<Row[]> {
    await this.assertProject(projectId);
    const result = await this.pool.query("SELECT * FROM stat.project_plan WHERE project_id = $1 ORDER BY plan_kind, version DESC", [projectId]);
    return result.rows;
  }

  async listDecisions(projectId: number, status: string | null = null): Promise<Row[]> {
    await this.assertProject(projectId);
    const result = await this.pool.query(
      `SELECT * FROM stat.project_decision WHERE project_id = $1 AND ($2::text IS NULL OR status = $2) ORDER BY risk_level DESC, id`,
      [projectId, status],
    );
    return result.rows;
  }

  async decide(projectId: number, decisionId: number, input: Row): Promise<Row> {
    await this.assertProject(projectId);
    const decision = str(input.decision, "decision") as string;
    const decidedBy = str(input.decidedBy ?? "boss", "decidedBy") as string;
    const result = await this.pool.query(
      `UPDATE stat.project_decision
       SET status = 'decided', decision = $3, decided_by = $4, decided_at = now()
       WHERE id = $2 AND project_id = $1 AND status = 'pending' RETURNING *`,
      [projectId, decisionId, decision, decidedBy],
    );
    const row = result.rows[0] as Row | undefined;
    if (row === undefined) throw new OpcError(ERR.AUTO_DECISION, `裁决项不存在或已处理：${decisionId}`, 404);
    await this.record("project.decision.decide", projectId, { decisionId, decision, decidedBy });
    return row;
  }
}
