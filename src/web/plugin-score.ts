/**
 * 插件雷达：对候选 DSH 插件做硬过滤与适用性评分。
 *
 * 边界（产品设计 9.8）：只给事实、评分与风险，不自动安装；安装必须由老板显式确认。
 * 硬过滤优先于评分：来源不可信、停更、权限过大、要求敏感数据出域的直接不推荐。
 */

export interface PluginCandidate {
  id: string;
  name: string;
  url: string;
  sourceTrusted: boolean;
  lastUpdatedAt: string;
  license?: string;
  permissions: string[];
  requiredViews?: string[];
  coverage?: string[];
  dataResidency?: "local" | "remote" | "unknown";
  stars?: number;
}

export interface CompanyProfileLite {
  domains?: string[];
  requiredViews?: string[];
  dataPolicy?: "local_only" | "allow_remote";
}

export interface PluginEvaluation {
  eligible: boolean;
  score: number;
  reasons: string[];
  risks: string[];
}

const EXCESSIVE_PERMISSIONS = new Set([
  "db.write.any",
  "audit.write",
  "customer_sensitive.read",
  "filesystem.root",
]);

export function evaluatePluginCandidate(
  candidate: PluginCandidate,
  profile: CompanyProfileLite,
  now: Date = new Date(),
): PluginEvaluation {
  const reasons: string[] = [];
  const risks: string[] = [];
  let eligible = true;

  const updated = new Date(candidate.lastUpdatedAt);
  const ageDays = Number.isNaN(updated.getTime()) ? Number.POSITIVE_INFINITY : (now.getTime() - updated.getTime()) / 86_400_000;
  if (!candidate.sourceTrusted) {
    eligible = false;
    risks.push("来源不可信");
  }
  if (ageDays > 365) {
    eligible = false;
    risks.push("超过 12 个月未更新");
  }
  if (candidate.permissions.some((permission) => EXCESSIVE_PERMISSIONS.has(permission))) {
    eligible = false;
    risks.push("权限范围明显大于功能所需");
  }
  if (profile.dataPolicy === "local_only" && candidate.dataResidency === "remote") {
    eligible = false;
    risks.push("要求敏感数据上传到远程端点，与数据不出域冲突");
  }

  const domains = new Set(profile.domains ?? []);
  const coverage = candidate.coverage ?? [];
  const covered = coverage.filter((domain) => domains.has(domain)).length;
  const coverageScore = domains.size === 0 ? 0 : covered / domains.size;

  const views = new Set(profile.requiredViews ?? []);
  const viewOverlap = (candidate.requiredViews ?? []).filter((view) => views.has(view)).length;
  const viewScore = views.size === 0 ? 0 : viewOverlap / views.size;

  const activityScore = Number.isFinite(ageDays) ? Math.max(0, 1 - ageDays / 365) : 0;
  const trustScore = candidate.sourceTrusted ? 1 : 0;
  const licenseScore = candidate.license !== undefined && candidate.license !== "" ? 1 : 0;
  const score = Number(
    (coverageScore * 0.35 + viewScore * 0.2 + activityScore * 0.2 + trustScore * 0.15 + licenseScore * 0.1).toFixed(3),
  );

  if (eligible) reasons.push("通过硬过滤");
  if (coverageScore > 0) reasons.push(`覆盖 ${covered}/${domains.size} 个已启用模块`);
  if (viewScore > 0) reasons.push(`与现有视图重合 ${viewOverlap} 个`);
  if (activityScore > 0.5) reasons.push("维护活跃");
  if (candidate.dataResidency === "local") reasons.push("数据驻留本地");

  return { eligible, score, reasons, risks };
}
