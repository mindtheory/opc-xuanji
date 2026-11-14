/**
 * OPC-玄机 · 一人公司中枢 —— 浏览器半（DSH Client 插件）。
 *
 * 左栏注册入口「OPC驾驶舱」，主面板是完整的应用控制台（类似传统管理软件）：
 *   驾驶舱 / 员工矩阵 / 业务域 / 流程 / 任务 / 审计 / 冲突 / 收件箱 / 记忆 / 雷达 / 设置
 * 覆盖 /api/v1 全部可操作面（员工启停与部署、认知派活与运行记录、流程注册/启动/节点完成/裁决、
 * 任务增改与立即执行、审计查询与导出、冲突裁决、归置确认、记忆检索与提案、雷达浏览、全局暂停）。
 *
 * 纪律（与 dsh-super-agents 面板同一套经验）：
 *  - 只在 slots 上注册；绝不 ctx.inject 等待 client 服务（会拖坏宿主启动）；
 *  - 所有宿主 API 访问都包错，面板永不向上抛异常；写操作成功后自动刷新；
 *  - factory 无副作用；样式随组件卸载。
 */
window.__ModuleLoader__.load({
  id: "opc-xuanji",
  factory: function (require) {
    var module = { exports: {} };
    var exports = module.exports;
    var react = require("react");
    var h = react.createElement;
    // Fragment 兜底：宿主 react 模块若没有 Fragment，就退回 div 包装
    var Fragment = (react && react.Fragment) || "div";

    var inject = ["slots", "locale"];
    var PANEL_ID = "opc-xuanji";
    var PANEL_ORDER = 27; // 超级智能体=26，雷达=30
    var API = "/api/v1";

    // ================= locale =================
    var localeId = "";
    var DICT = {
      zh: {
        "panel.title": "OPC驾驶舱", "panel.sub": "一人公司中枢 · 全功能控制台", "panel.refresh": "刷新", "panel.loading": "加载中…",
        "panel.ok": "健康", "panel.degraded": "降级", "panel.pg": "PostgreSQL", "panel.pgvector": "pgvector", "panel.tasks": "调度任务",
        "panel.agents": "员工智能体", "panel.agentsPaused": "已暂停", "panel.queue": "队列", "panel.running": "运行", "panel.inbox": "待归置",
        "panel.frozen": "冻结事件", "panel.frozenHint": "总额含冻结，按脚注口径", "panel.asOf": "快照时间", "panel.stale": "快照陈旧",
        "panel.next": "下次", "panel.last": "上次", "panel.range.today": "今日", "panel.range.7d": "7天", "panel.range.30d": "30天", "panel.range.90d": "90天",
        "panel.error": "加载失败", "panel.retry": "重试", "panel.close": "关闭", "panel.save": "保存", "panel.cancel": "取消", "panel.confirm": "确认", "panel.ignore": "忽略",
        "panel.run": "立即执行", "panel.export": "导出", "panel.deploy": "部署角色卡", "panel.dispatch": "派活", "panel.dispatchFor": "派给",
        "panel.taskPlaceholder": "这次要它做什么？（具体、可验收）", "panel.runs": "运行记录", "panel.enabled": "启用", "panel.disabled": "停用",
        "panel.install": "安装", "panel.import": "导入员工包", "panel.exportPkg": "导出员工包", "panel.empty": "暂无数据", "panel.search": "检索",
        "panel.propose": "提出记忆", "panel.confirmProposal": "确认提案", "panel.resolve": "裁决", "panel.start": "启动实例", "panel.detail": "详情",
        "panel.back": "返回", "panel.register": "注册流程", "panel.completeNode": "完成节点", "panel.verdict": "评判", "panel.pause": "全局暂停认知调度",
        "panel.resume": "恢复", "panel.pauseHint": "暂停只影响认知调度；确定性 SQL 任务照常",
      },
      en: {
        "panel.title": "OPC Cockpit", "panel.sub": "One-Person Company Hub · full console", "panel.refresh": "Refresh", "panel.loading": "loading…",
        "panel.ok": "Healthy", "panel.degraded": "Degraded", "panel.pg": "PostgreSQL", "panel.pgvector": "pgvector", "panel.tasks": "Tasks",
        "panel.agents": "Employee agents", "panel.agentsPaused": "paused", "panel.queue": "queue", "panel.running": "running", "panel.inbox": "Inbox",
        "panel.frozen": "Frozen events", "panel.frozenHint": "amounts include frozen units (see footnotes)", "panel.asOf": "as of", "panel.stale": "stale snapshot",
        "panel.next": "next", "panel.last": "last", "panel.range.today": "Today", "panel.range.7d": "7d", "panel.range.30d": "30d", "panel.range.90d": "90d",
        "panel.error": "load failed", "panel.retry": "Retry", "panel.close": "Close", "panel.save": "Save", "panel.cancel": "Cancel", "panel.confirm": "Confirm", "panel.ignore": "Ignore",
        "panel.run": "Run now", "panel.export": "Export", "panel.deploy": "Deploy card", "panel.dispatch": "Dispatch", "panel.dispatchFor": "Dispatch to",
        "panel.taskPlaceholder": "What should it do? (specific, verifiable)", "panel.runs": "Runs", "panel.enabled": "Enabled", "panel.disabled": "Disabled",
        "panel.install": "Install", "panel.import": "Import package", "panel.exportPkg": "Export package", "panel.empty": "No data", "panel.search": "Search",
        "panel.propose": "Propose memory", "panel.confirmProposal": "Confirm proposal", "panel.resolve": "Resolve", "panel.start": "Start instance", "panel.detail": "Detail",
        "panel.back": "Back", "panel.register": "Register workflow", "panel.completeNode": "Complete node", "panel.verdict": "Judge", "panel.pause": "Pause cognitive scheduling",
        "panel.resume": "Resume", "panel.pauseHint": "only cognitive scheduling pauses; deterministic SQL tasks keep running",
      },
    };
    function currentLang() {
      if (localeId) return localeId;
      try { return (document.documentElement.lang || "zh").split("-")[0]; } catch (e) { return "zh"; }
    }
    function t(key) {
      var d = DICT[currentLang()] || DICT.zh;
      return d[key] || DICT.en[key] || key;
    }

    // ================= API =================
    function api(method, path, body) {
      var init = { method: method, headers: body === undefined ? { accept: "application/json" } : { accept: "application/json", "content-type": "application/json" } };
      if (body !== undefined) init.body = JSON.stringify(body);
      return fetch(API + path, init).then(function (res) {
        return res.json().then(function (data) {
          if (!res.ok || !data || data.code !== 0) throw new Error((data && (data.message || data.errorCode)) || "HTTP " + res.status);
          return data.data;
        });
      });
    }
    function apiGet(path) { return api("GET", path); }
    function apiPost(path, body) { return api("POST", path, body); }
    function apiPut(path, body) { return api("PUT", path, body); }
    function apiPatch(path, body) { return api("PATCH", path, body); }
    function apiDelete(path, body) { return api("DELETE", path, body); }
    function qs(params) {
      var parts = [];
      for (var k in params) {
        if (params[k] === undefined || params[k] === null || params[k] === "") continue;
        parts.push(encodeURIComponent(k) + "=" + encodeURIComponent(params[k]));
      }
      return parts.length ? "?" + parts.join("&") : "";
    }

    // ================= formatters =================
    function fmtNum(n) {
      if (typeof n !== "number" || !isFinite(n)) return String(n);
      if (Math.abs(n) >= 10000) return (n / 10000).toFixed(1) + "万";
      return String(Math.round(n * 100) / 100);
    }
    function fmtTime(iso) {
      if (!iso) return "-";
      try { return new Date(iso).toLocaleString(); } catch (e) { return String(iso); }
    }
    function fmtVal(v) {
      if (v === null || v === undefined) return "-";
      if (typeof v === "object") return JSON.stringify(v);
      return String(v);
    }
    function short(v, n) {
      var s = typeof v === "string" ? v : JSON.stringify(v);
      s = s || "";
      return s.length > (n || 40) ? s.slice(0, n || 40) + "…" : s;
    }
    function parseJson(text, fallback) {
      try { return text === undefined || text === "" ? fallback : JSON.parse(text); }
      catch (e) { throw new Error("JSON 解析失败：" + e.message); }
    }

    // ================= styles =================
    // 设计令牌：全部挂在 .ocRoot 上，面板可在宿主浅色/深色主题下复用同一套结构。
    var CSS = [
      ".ocRoot{--oc-radius:10px;--oc-radius-lg:14px;--oc-gap:12px;--oc-pad:14px;--oc-accent:#2563eb;--oc-on-accent:#fff;--oc-accent-weak:rgba(37,99,235,.10);--oc-ok:#15803d;--oc-ok-weak:rgba(21,128,61,.12);--oc-warn:#b45309;--oc-warn-weak:rgba(180,83,9,.13);--oc-bad:#b91c1c;--oc-bad-weak:rgba(185,28,28,.12);--oc-border:rgba(128,128,128,.20);--oc-border-strong:rgba(128,128,128,.34);--oc-surface:rgba(128,128,128,.05);--oc-surface-2:rgba(128,128,128,.08);--oc-hover:rgba(128,128,128,.12);--oc-mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;--oc-shadow:0 1px 2px rgba(0,0,0,.04),0 8px 24px rgba(0,0,0,.06);box-sizing:border-box;position:relative;height:100%;min-height:0;color:inherit;font-size:13px;line-height:1.5;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}",
      ".ocRoot *,.ocRoot *::before,.ocRoot *::after{box-sizing:border-box}",
      "@media (prefers-color-scheme:dark){.ocRoot{--oc-accent:#60a5fa;--oc-on-accent:#0b1220;--oc-accent-weak:rgba(96,165,250,.15);--oc-ok:#4ade80;--oc-ok-weak:rgba(74,222,128,.14);--oc-warn:#fbbf24;--oc-warn-weak:rgba(251,191,36,.14);--oc-bad:#f87171;--oc-bad-weak:rgba(248,113,113,.14);--oc-shadow:0 1px 2px rgba(0,0,0,.3),0 10px 30px rgba(0,0,0,.35)}}",
      ".ocRoot :focus-visible{outline:2px solid var(--oc-accent);outline-offset:2px;border-radius:6px}",
      ".ocSrOnly{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}",
      // shell
      ".ocShell{height:100%;min-height:0;display:grid;grid-template-columns:212px minmax(0,1fr);grid-template-rows:auto minmax(0,1fr);border:1px solid var(--oc-border);border-radius:var(--oc-radius-lg);background:var(--oc-surface);overflow:hidden;box-shadow:var(--oc-shadow)}",
      ".ocHead{grid-column:1/-1;display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid var(--oc-border);background:var(--oc-surface-2)}",
      ".ocBrand{display:flex;align-items:center;gap:10px;min-width:0}",
      ".ocBrandMark{width:34px;height:34px;border-radius:10px;display:grid;place-items:center;color:var(--oc-accent);background:var(--oc-accent-weak);border:1px solid var(--oc-border);flex:0 0 auto}",
      ".ocTitle{font-size:16px;font-weight:700;letter-spacing:.2px;margin:0;line-height:1.25;white-space:nowrap}",
      ".ocSub{font-size:12px;opacity:.62;margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      ".ocRight{margin-left:auto;display:flex;align-items:center;gap:8px;flex:0 0 auto}",
      // navigation
      ".ocNav{grid-row:2;grid-column:1;display:flex;flex-direction:column;gap:14px;padding:10px 8px;border-right:1px solid var(--oc-border);overflow-y:auto;overflow-x:hidden;background:var(--oc-surface);scrollbar-gutter:stable}",
      ".ocNavGroup{display:flex;flex-direction:column;gap:2px}",
      ".ocNavGroupTitle{font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;opacity:.5;padding:0 10px 4px;font-weight:600;white-space:nowrap}",
      ".ocNavItem{display:flex;align-items:center;gap:9px;width:100%;text-align:left;border:0;background:transparent;color:inherit;font:inherit;font-size:12.5px;padding:7px 10px;border-radius:8px;cursor:pointer;white-space:nowrap;min-height:34px;transition:background-color .15s ease,color .15s ease}",
      ".ocNavItem:hover{background:var(--oc-hover)}",
      ".ocNavItem[aria-selected=true]{background:var(--oc-accent-weak);color:var(--oc-accent);font-weight:600}",
      ".ocNavIcon{display:grid;place-items:center;width:18px;height:18px;flex:0 0 auto;opacity:.9}",
      ".ocNavLabel{overflow:hidden;text-overflow:ellipsis}",
      ".ocNavBadge{margin-left:auto;font-size:10px;font-weight:700;line-height:1;padding:3px 6px;border-radius:999px;background:var(--oc-warn-weak);color:var(--oc-warn)}",
      ".ocMain{grid-row:2;grid-column:2;min-width:0;min-height:0;display:flex;flex-direction:column;overflow:hidden}",
      ".ocBody{flex:1 1 auto;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:var(--oc-gap);padding:var(--oc-pad);scrollbar-gutter:stable}",
      // page header
      ".ocPageHead{display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap;padding-bottom:2px}",
      ".ocPageHeadText{min-width:0;flex:1 1 220px}",
      ".ocPageTitle{font-size:15px;font-weight:700;margin:0;line-height:1.3;letter-spacing:.2px}",
      ".ocPageSub{margin:2px 0 0;font-size:12px;opacity:.62}",
      ".ocPageActions{margin-left:auto;display:flex;align-items:center;gap:8px;flex-wrap:wrap}",
      // badges / buttons
      ".ocBadge{display:inline-flex;align-items:center;gap:5px;border-radius:999px;padding:2px 10px;font-size:12px;border:1px solid var(--oc-border-strong);white-space:nowrap;font-weight:500}",
      ".ocBadge.ok{color:var(--oc-ok);border-color:var(--oc-ok);background:var(--oc-ok-weak)}",
      ".ocBadge.warn{color:var(--oc-warn);border-color:var(--oc-warn);background:var(--oc-warn-weak)}",
      ".ocBadge.bad{color:var(--oc-bad);border-color:var(--oc-bad);background:var(--oc-bad-weak)}",
      ".ocBadge.mute{opacity:.65}",
      ".ocBtn{display:inline-flex;align-items:center;justify-content:center;gap:6px;border:1px solid var(--oc-border-strong);border-radius:8px;background:transparent;color:inherit;font:inherit;font-size:12px;font-weight:500;padding:5px 11px;min-height:30px;cursor:pointer;white-space:nowrap;transition:background-color .15s ease,border-color .15s ease,color .15s ease,filter .15s ease}",
      ".ocBtn:hover{background:var(--oc-hover)}",
      ".ocBtn.primary{border-color:transparent;background:var(--oc-accent);color:var(--oc-on-accent)}",
      ".ocBtn.primary:hover{filter:brightness(1.06)}",
      ".ocBtn.danger{border-color:var(--oc-bad);color:var(--oc-bad)}",
      ".ocBtn.danger:hover{background:var(--oc-bad-weak)}",
      ".ocBtn:disabled,.ocBtn[aria-disabled=true]{opacity:.4;cursor:not-allowed;filter:none}",
      // legacy tabs (kept for host/older markup) + segmented control
      ".ocTabs{display:flex;gap:6px;flex-wrap:wrap;border-bottom:1px solid var(--oc-border);padding-bottom:8px}",
      ".ocTab{border:1px solid var(--oc-border-strong);border-radius:8px;padding:3px 10px;font-size:12px;cursor:pointer;user-select:none;white-space:nowrap}",
      ".ocTab.on{background:var(--oc-surface-2);font-weight:600}",
      ".ocSeg{display:inline-flex;gap:2px;padding:2px;border:1px solid var(--oc-border);border-radius:9px;background:var(--oc-surface);flex-wrap:wrap}",
      ".ocSegItem{border:0;border-radius:7px;background:transparent;color:inherit;font:inherit;font-size:12px;padding:4px 10px;min-height:28px;cursor:pointer;white-space:nowrap}",
      ".ocSegItem:hover{background:var(--oc-hover)}",
      ".ocSegItem.on,.ocSegItem[aria-pressed=true]{background:var(--oc-accent-weak);color:var(--oc-accent);font-weight:600}",
      // chips / metrics
      ".ocStrip{display:flex;flex-wrap:wrap;gap:8px}",
      ".ocChip{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--oc-border);border-radius:8px;padding:5px 9px;font-size:12px;background:var(--oc-surface)}",
      ".ocDot{width:7px;height:7px;border-radius:50%;display:inline-block;flex:0 0 auto}",
      ".ocDot.ok{background:var(--oc-ok)}.ocDot.bad{background:var(--oc-bad)}.ocDot.warn{background:var(--oc-warn)}.ocDot.mute{background:#8a8a8a}",
      ".ocMetrics{display:grid;grid-template-columns:repeat(auto-fill,minmax(118px,1fr));gap:10px}",
      ".ocMetric{border:1px solid var(--oc-border);border-radius:var(--oc-radius);padding:9px 10px;background:var(--oc-surface);transition:border-color .15s ease,background-color .15s ease,transform .15s ease}",
      ".ocMetric:hover{border-color:var(--oc-border-strong);background:var(--oc-surface-2)}",
      ".ocMetric b{display:block;font-size:19px;line-height:1.3;font-weight:650;font-variant-numeric:tabular-nums;margin-top:2px}",
      ".ocMetric span{opacity:.62;font-size:11px}",
      // cards / sections
      ".ocCard,.ocSection,.ocDomain{border:1px solid var(--oc-border);border-radius:var(--oc-radius);padding:12px;display:flex;flex-direction:column;gap:8px;background:var(--oc-surface);min-width:0}",
      ".ocSection{background:transparent}",
      ".ocGrid2{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px}",
      ".ocH{font-weight:600;font-size:13px;display:flex;align-items:center;gap:8px;line-height:1.4}",
      ".ocCount{margin-left:auto;opacity:.55;font-size:11px;font-weight:400;font-variant-numeric:tabular-nums}",
      ".ocMuted{opacity:.62;font-size:12px}",
      ".ocRow{display:flex;align-items:center;gap:8px;font-size:12px;flex-wrap:wrap;min-width:0}",
      ".ocList{display:flex;flex-direction:column;gap:6px}",
      ".ocEllip{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1}",
      ".ocMono{font-family:var(--oc-mono);font-size:11px;opacity:.85}",
      ".ocDomainName{font-weight:600;font-size:13px;display:flex;align-items:center;gap:6px;flex-wrap:wrap}",
      ".ocDomainName span{opacity:.55;font-size:11px;font-weight:400}",
      // feedback
      ".ocErr{display:flex;align-items:center;gap:10px;flex-wrap:wrap;color:var(--oc-bad);font-size:12px;border:1px solid var(--oc-bad);border-radius:8px;padding:8px 10px;background:var(--oc-bad-weak)}",
      ".ocErrMsg{flex:1 1 200px;min-width:0;word-break:break-word}",
      ".ocEmpty{opacity:.55;font-size:12px}",
      ".ocEmptyState{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;text-align:center;padding:22px 12px;border:1px dashed var(--oc-border-strong);border-radius:var(--oc-radius);color:inherit}",
      ".ocEmptyIcon{opacity:.4;display:grid;place-items:center}",
      ".ocEmptyTitle{font-weight:600;font-size:12.5px}",
      ".ocEmptyHint{opacity:.6;font-size:11.5px;max-width:34em}",
      ".ocFrozen{border:1px solid var(--oc-warn);border-radius:8px;padding:6px 10px;font-size:12px;color:var(--oc-warn);background:var(--oc-warn-weak)}",
      ".ocFoot{display:flex;gap:12px;flex-wrap:wrap;opacity:.55;font-size:11px;margin-top:2px}",
      ".ocToast{position:absolute;right:16px;bottom:16px;z-index:40;display:flex;align-items:center;gap:10px;max-width:min(420px,calc(100% - 32px));border:1px solid var(--oc-accent);border-radius:10px;padding:9px 12px;font-size:12px;background:var(--oc-accent-weak);color:inherit;box-shadow:var(--oc-shadow);animation:ocToastIn .18s ease-out}",
      ".ocToast.bad{border-color:var(--oc-bad);background:var(--oc-bad-weak);color:var(--oc-bad)}",
      ".ocToastMsg{flex:1 1 auto;min-width:0}",
      ".ocToastClose{border:0;background:transparent;color:inherit;font:inherit;font-size:14px;line-height:1;cursor:pointer;opacity:.65;padding:2px}",
      ".ocToastClose:hover{opacity:1}",
      "@keyframes ocToastIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}",
      // tables
      ".ocScroll{overflow:auto;max-height:min(460px,60vh);border:1px solid var(--oc-border);border-radius:var(--oc-radius);background:transparent}",
      ".ocTable{width:100%;border-collapse:collapse;font-size:12px}",
      ".ocTable th{position:sticky;top:0;z-index:1;text-align:left;font-weight:600;opacity:.7;padding:7px 9px;border-bottom:1px solid var(--oc-border-strong);white-space:nowrap;background:var(--oc-surface-2);backdrop-filter:blur(8px)}",
      ".ocTable td{padding:7px 9px;border-bottom:1px solid var(--oc-border);vertical-align:top;white-space:nowrap}",
      ".ocTable tbody tr:last-child td{border-bottom:0}",
      ".ocTable tr:hover td{background:var(--oc-hover)}",
      ".ocTableSkeleton{display:flex;flex-direction:column;gap:8px;padding:10px}",
      ".ocSkelRow{display:flex;gap:10px;align-items:center}",
      ".ocSkel{height:12px;border-radius:6px;background:var(--oc-surface-2);animation:ocShimmer 1.4s ease-in-out infinite}",
      "@keyframes ocShimmer{0%{opacity:.45}50%{opacity:.9}100%{opacity:.45}}",
      // forms
      ".ocField{display:flex;flex-direction:column;gap:4px;font-size:12px;min-width:0}",
      ".ocFieldLabel{opacity:.7;display:flex;align-items:center;gap:4px}",
      ".ocReq{color:var(--oc-bad);font-style:normal}",
      ".ocFieldHelp{opacity:.55;font-size:11px}",
      ".ocField input,.ocField select,.ocField textarea{border:1px solid var(--oc-border-strong);border-radius:8px;background:transparent;color:inherit;font-size:12px;padding:6px 9px;font-family:inherit;min-width:0;width:100%}",
      ".ocField input:hover,.ocField select:hover,.ocField textarea:hover{border-color:var(--oc-accent)}",
      ".ocField input:focus-visible,.ocField select:focus-visible,.ocField textarea:focus-visible{outline:2px solid var(--oc-accent);outline-offset:1px;border-color:transparent}",
      ".ocField textarea{font-family:var(--oc-mono);min-height:64px;resize:vertical}",
      ".ocFormRow{display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end}",
      ".ocFormRow>.ocField{flex:1 1 140px;min-width:120px}",
      // admin console
      ".ocSplit{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:12px;align-items:start}",
      ".ocSplitMain{min-width:0;display:flex;flex-direction:column;gap:8px}",
      ".ocSplitSide{min-width:0;display:flex;flex-direction:column;gap:8px;position:sticky;top:0;max-height:calc(100vh - 200px);overflow:auto}",
      ".ocFormStack{display:flex;flex-direction:column;gap:8px}",
      ".ocFormStack .ocField{flex:none}",
      ".ocField textarea{min-height:56px}",
      ".ocBar{height:8px;border-radius:999px;background:var(--oc-surface-2);overflow:hidden;border:1px solid var(--oc-border)}",
      ".ocBar>i{display:block;height:100%;background:var(--oc-accent);border-radius:999px;transition:width .3s ease}",
      ".ocMeta{display:flex;gap:12px;flex-wrap:wrap;align-items:center;font-size:12px}",
      ".ocMeta b{font-variant-numeric:tabular-nums}",
      ".ocMetric.ok b{color:var(--oc-ok)}.ocMetric.warn b{color:var(--oc-warn)}.ocMetric.bad b{color:var(--oc-bad)}",
      ".ocDetail{display:flex;flex-direction:column;gap:8px}",
      ".ocDetail h4{margin:0;font-size:12px;letter-spacing:.02em;opacity:.7}",
      ".ocDetailList{display:flex;flex-direction:column;gap:6px;margin:0;padding:0;list-style:none}",
      ".ocDetailItem{border:1px solid var(--oc-border);border-radius:8px;padding:8px;display:flex;flex-direction:column;gap:3px;background:var(--oc-surface)}",
      ".ocDetailItem a{color:var(--oc-accent);text-decoration:none;word-break:break-all}",
      ".ocDetailItem a:hover{text-decoration:underline}",
      ".ocTag{display:inline-flex;align-items:center;border:1px solid var(--oc-border-strong);border-radius:999px;padding:1px 7px;font-size:10.5px;margin:1px 3px 1px 0;opacity:.85}",
      ".ocJson{max-height:260px;overflow:auto;margin:0;padding:8px;border:1px solid var(--oc-border);border-radius:8px;background:var(--oc-surface);font-family:var(--oc-mono);font-size:11px;white-space:pre-wrap}",
      ".ocStickyActions{display:flex;gap:6px;flex-wrap:wrap;align-items:center}",
      ".ocHint{font-size:11px;opacity:.6;line-height:1.45}",
      ".ocDangerText{color:var(--oc-bad)}",
      ".ocProgressWrap{display:flex;align-items:center;gap:8px;min-width:180px;max-width:340px;flex:1 1 180px}",
      ".ocProgressWrap .ocBar{flex:1}",
      "@media (max-width:1100px){.ocSplit{grid-template-columns:minmax(0,1fr) 300px}}",
      "@media (max-width:860px){.ocSplit{grid-template-columns:1fr}.ocSplitSide{position:static;max-height:none;overflow:visible}}",
      // motion / responsive
      "@media (prefers-reduced-motion:reduce){.ocRoot *,.ocRoot *::before,.ocRoot *::after{animation:none!important;transition:none!important}}",
      "@media (pointer:coarse){.ocBtn,.ocNavItem,.ocTab,.ocSegItem{min-height:40px}}",
      "@media (max-width:860px){.ocShell{grid-template-columns:1fr;grid-template-rows:auto auto minmax(0,1fr)}.ocHead{grid-column:1}.ocNav{grid-row:2;grid-column:1;flex-direction:row;align-items:center;gap:6px;padding:6px 8px;border-right:0;border-bottom:1px solid var(--oc-border);overflow-x:auto;overflow-y:hidden}.ocNavGroup{display:contents}.ocNavGroupTitle{display:none}.ocNavItem{width:auto;padding:6px 10px}.ocMain{grid-row:3;grid-column:1}.ocBody{padding:12px}.ocPageActions{margin-left:0}}",
      "@media (max-width:520px){.ocShell{border-radius:0;border-left:0;border-right:0}.ocTitle{font-size:15px}.ocSub{display:none}.ocMetric b{font-size:17px}.ocToast{right:10px;bottom:10px}}",
    ].join("\n");

    function StyleTag() { return h("style", null, CSS); }

    // ================= icons =================
    var ICONS = {
      gauge: [h("path", { key: "a", d: "M4 14a8 8 0 1 1 16 0" }), h("path", { key: "b", d: "M12 14l4.2-4.2" }), h("circle", { key: "c", cx: 12, cy: 14, r: 1.6 }), h("path", { key: "d", d: "M4 18h16" })],
      grid: [h("rect", { key: "a", x: 4, y: 4, width: 6, height: 6, rx: 1.4 }), h("rect", { key: "b", x: 14, y: 4, width: 6, height: 6, rx: 1.4 }), h("rect", { key: "c", x: 4, y: 14, width: 6, height: 6, rx: 1.4 }), h("rect", { key: "d", x: 14, y: 14, width: 6, height: 6, rx: 1.4 })],
      users: [h("circle", { key: "a", cx: 9, cy: 8, r: 3 }), h("path", { key: "b", d: "M3.5 19a5.5 5.5 0 0 1 11 0" }), h("path", { key: "c", d: "M16 5.6a3 3 0 0 1 0 5.8" }), h("path", { key: "d", d: "M17.5 13.6A5.5 5.5 0 0 1 20.5 19" })],
      flow: [h("rect", { key: "a", x: 3, y: 4, width: 7, height: 5, rx: 1.2 }), h("rect", { key: "b", x: 14, y: 15, width: 7, height: 5, rx: 1.2 }), h("path", { key: "c", d: "M10 6.5h4a3 3 0 0 1 3 3v3" }), h("path", { key: "d", d: "M6.5 9v3a3 3 0 0 0 3 3h4.5" })],
      clock: [h("circle", { key: "a", cx: 12, cy: 12, r: 8.5 }), h("path", { key: "b", d: "M12 7.5v5l3 2" })],
      shield: [h("path", { key: "a", d: "M12 3.5 19 6v5.5c0 4.2-2.9 7.4-7 9-4.1-1.6-7-4.8-7-9V6l7-2.5Z" }), h("path", { key: "b", d: "m9 12 2 2 4-4" })],
      alert: [h("path", { key: "a", d: "M12 4 21 20H3L12 4Z" }), h("path", { key: "b", d: "M12 10v4" }), h("circle", { key: "c", cx: 12, cy: 17, r: 0.6 })],
      inbox: [h("path", { key: "a", d: "M4 5h16v11H4z" }), h("path", { key: "b", d: "M4 12h4l1.5 2h5L16 12h4" }), h("path", { key: "c", d: "M8 20h8" })],
      book: [h("path", { key: "a", d: "M5 4h9a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4Z" }), h("path", { key: "b", d: "M17 20h2V7" }), h("path", { key: "c", d: "M8 8h6" }), h("path", { key: "d", d: "M8 11h6" })],
      sync: [h("path", { key: "a", d: "M20 11a8 8 0 0 0-14-4.5L4 9" }), h("path", { key: "b", d: "M4 4v5h5" }), h("path", { key: "c", d: "M4 13a8 8 0 0 0 14 4.5L20 15" }), h("path", { key: "d", d: "M20 20v-5h-5" })],
      radar: [h("circle", { key: "a", cx: 12, cy: 12, r: 8.5 }), h("circle", { key: "b", cx: 12, cy: 12, r: 4.5 }), h("path", { key: "c", d: "M12 12 17 7" }), h("circle", { key: "d", cx: 12, cy: 12, r: 0.8 })],
      settings: [h("circle", { key: "a", cx: 12, cy: 12, r: 3 }), h("path", { key: "b", d: "M12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2M6 6l1.4 1.4M16.6 16.6 18 18M18 6l-1.4 1.4M7.4 16.6 6 18" })],
      layers: [h("path", { key: "a", d: "m12 4 8 4-8 4-8-4 8-4Z" }), h("path", { key: "b", d: "m4 12 8 4 8-4" }), h("path", { key: "c", d: "m4 16 8 4 8-4" })],
      target: [h("circle", { key: "a", cx: 12, cy: 12, r: 8.5 }), h("circle", { key: "b", cx: 12, cy: 12, r: 4.5 }), h("circle", { key: "c", cx: 12, cy: 12, r: 1 })],
      refresh: [h("path", { key: "a", d: "M20 11a8 8 0 1 0-2.3 6.3" }), h("path", { key: "b", d: "M20 4v7h-7" })],
      back: [h("path", { key: "a", d: "M19 12H5" }), h("path", { key: "b", d: "m11 18-6-6 6-6" })],
      x: [h("path", { key: "a", d: "M6 6l12 12" }), h("path", { key: "b", d: "M18 6 6 18" })],
      check: [h("path", { key: "a", d: "m5 12.5 4.5 4.5L19 7.5" })],
      dot: [h("circle", { key: "a", cx: 12, cy: 12, r: 3 })],
    };
    function Icon(props) {
      var size = typeof props.size === "number" && props.size > 0 ? props.size : 16;
      return h("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", focusable: "false" },
        ICONS[props.name] || ICONS.dot);
    }

    // ================= shared components =================
    function Btn(props) {
      return h("button", {
        type: "button",
        className: "ocBtn" + (props.kind ? " " + props.kind : ""),
        onClick: props.onClick,
        disabled: props.disabled,
        title: props.title,
        "aria-label": props.ariaLabel,
      }, props.children || props.label);
    }
    function Badge(props) { return h("span", { className: "ocBadge " + (props.tone || "mute") }, props.children); }
    function Card(props) { return h("div", { className: "ocCard" }, props.children); }
    function Dot(props) { return h("span", { className: "ocDot " + (props.state || "mute"), "aria-hidden": "true" }); }
    function Field(props) {
      return h("label", { className: "ocField" },
        h("span", { className: "ocFieldLabel" }, props.label, props.required ? h("em", { className: "ocReq", "aria-hidden": "true" }, "*") : null),
        h("input", { value: props.value, onChange: function (e) { props.onChange(e.target.value); }, placeholder: props.placeholder || "", type: props.type || "text", disabled: props.disabled, autoComplete: props.autoComplete || "off", required: props.required, "aria-describedby": props.hint ? props.hintId : undefined }),
        props.hint ? h("span", { className: "ocFieldHelp", id: props.hintId }, props.hint) : null);
    }
    function NumField(props) {
      return h("label", { className: "ocField" },
        h("span", { className: "ocFieldLabel" }, props.label),
        h("input", { value: props.value, type: "number", onChange: function (e) { props.onChange(Number(e.target.value)); }, disabled: props.disabled, min: props.min, max: props.max, step: props.step }));
    }
    function Area(props) {
      return h("label", { className: "ocField" },
        h("span", { className: "ocFieldLabel" }, props.label),
        h("textarea", { value: props.value, onChange: function (e) { props.onChange(e.target.value); }, placeholder: props.placeholder || "", rows: props.rows || 4, disabled: props.disabled }));
    }
    function Select(props) {
      return h("label", { className: "ocField" },
        h("span", { className: "ocFieldLabel" }, props.label),
        h("select", { value: props.value, onChange: function (e) { props.onChange(e.target.value); }, disabled: props.disabled },
          (props.options || []).map(function (o) { return h("option", { key: o.value, value: o.value }, o.label); })));
    }
    function SkeletonTable(props) {
      var cols = (props.columns || []).length || 4;
      var rows = props.rows || 4;
      var widths = ["42%", "68%", "54%", "76%", "60%"];
      return h("div", { className: "ocTableSkeleton", role: "status", "aria-busy": "true", "aria-label": t("panel.loading") },
        Array.apply(null, Array(rows)).map(function (_, i) {
          return h("div", { className: "ocSkelRow", key: i },
            Array.apply(null, Array(cols)).map(function (__, j) {
              return h("span", { key: j, className: "ocSkel", style: { width: widths[j % widths.length], flex: j === 0 ? "0 0 24%" : "1 1 0" } });
            }));
        }));
    }
    function EmptyState(props) {
      return h("div", { className: "ocEmptyState" },
        h("div", { className: "ocEmptyIcon", "aria-hidden": "true" }, h(Icon, { name: props.icon || "inbox", size: 22 })),
        h("div", { className: "ocEmptyTitle" }, props.title || t("panel.empty")),
        props.hint ? h("div", { className: "ocEmptyHint" }, props.hint) : null,
        props.action || null);
    }
    function PageHeader(props) {
      return h("div", { className: "ocPageHead" },
        h("div", { className: "ocPageHeadText" },
          h("h2", { className: "ocPageTitle" }, props.title),
          props.subtitle ? h("p", { className: "ocPageSub" }, props.subtitle) : null),
        props.children ? h("div", { className: "ocPageActions" }, props.children) : null);
    }
    function Table(props) {
      var cols = props.columns || [];
      var rows = props.rows || [];
      if (!rows.length) {
        if (props.loading) return h("div", { className: "ocScroll" }, h(SkeletonTable, { columns: cols, rows: 4 }));
        return h(EmptyState, { title: props.empty || t("panel.empty"), hint: props.emptyHint, icon: props.emptyIcon });
      }
      return h("div", { className: "ocScroll" },
        h("table", { className: "ocTable" },
          props.caption ? h("caption", { className: "ocSrOnly" }, props.caption) : null,
          h("thead", null, h("tr", null, cols.map(function (c) { return h("th", { key: c.key, scope: "col" }, c.label); }))),
          h("tbody", null, rows.map(function (r, i) {
            return h("tr", { key: r.__key || i }, cols.map(function (c) { return h("td", { key: c.key }, c.render ? c.render(r) : fmtVal(r[c.key])); }));
          }))));
    }
    function ErrLine(props) {
      if (!props.error) return null;
      return h("div", { className: "ocErr", role: "alert" },
        h("span", { className: "ocErrMsg" }, t("panel.error") + "：" + props.error),
        props.onRetry ? h(Btn, { onClick: props.onRetry }, t("panel.retry")) : null);
    }
    function useLoad(loader, deps) {
      var st = react.useState({ loading: true, error: "", data: null });
      var s = st[0], set = st[1];
      var tickS = react.useState(0);
      var tick = tickS[0], setTick = tickS[1];
      react.useEffect(function () {
        var alive = true;
        set(function (p) { return { loading: true, error: "", data: p.data }; });
        Promise.resolve().then(loader).then(function (d) { if (alive) set({ loading: false, error: "", data: d }); })
          .catch(function (e) { if (alive) set(function (p) { return { loading: false, error: String((e && e.message) || e), data: p.data }; }); });
        return function () { alive = false; };
      }, (deps || []).concat([tick]));
      return [s, function () { setTick(function (v) { return v + 1; }); }];
    }

    // ================= 驾驶舱 =================
    function CockpitTab(props) {
      var rangeS = react.useState("30d");
      var range = rangeS[0], setRange = rangeS[1];
      var dashS = useLoad(function () { return apiGet("/web/dashboard" + qs({ range: range })); }, [range]);
      var healthS = useLoad(function () { return apiGet("/health"); }, []);
      var reportS = react.useState({ loading: false, error: "", data: null });
      var report = reportS[0], setReport = reportS[1];
      var reportTickS = react.useState(0);
      var reportTick = reportTickS[0], reloadReport = reportTickS[1];
      react.useEffect(function () {
        var alive = true;
        setReport({ loading: true, error: "", data: null });
        apiGet("/reports/daily").then(function (d) { if (alive) setReport({ loading: false, error: "", data: d }); })
          .catch(function (e) { if (alive) setReport({ loading: false, error: String((e && e.message) || e), data: null }); });
        return function () { alive = false; };
      }, [reportTick]);
      function reloadAll() { dashS[1](); healthS[1](); reloadReport(function (v) { return v + 1; }); }

      var health = healthS[0].data || {};
      var agents = health.agents || {};
      var dash = dashS[0].data;
      var groups = {}, groupOrder = [];
      if (dash && dash.metrics) {
        dash.metrics.forEach(function (m) {
          if (!groups[m.group]) { groups[m.group] = []; groupOrder.push(m.group); }
          groups[m.group].push(m);
        });
      }
      var ranges = ["today", "7d", "30d", "90d"];
      return h(Fragment, null,
        h(PageHeader, { title: "驾驶舱", subtitle: "健康状态 · 经营指标 · 晨报" },
          h("div", { className: "ocSeg", role: "group", "aria-label": "统计区间" },
            ranges.map(function (r) {
              var on = r === range;
              return h("button", { key: r, type: "button", className: "ocSegItem" + (on ? " on" : ""), "aria-pressed": on ? "true" : "false", onClick: function () { setRange(r); } }, t("panel.range." + r));
            })),
          h(Btn, { onClick: reloadAll, title: t("panel.refresh") }, h(Icon, { name: "refresh", size: 14 }), t("panel.refresh"))),
        h("div", { className: "ocStrip" },
          h("div", { className: "ocChip", title: t("panel.pg") + " · " + (health.pg ? t("panel.ok") : t("panel.error")) }, h(Dot, { state: health.pg ? "ok" : "bad" }), t("panel.pg")),
          h("div", { className: "ocChip", title: t("panel.pgvector") + " · " + (health.pgvector ? t("panel.ok") : t("panel.error")) }, h(Dot, { state: health.pgvector ? "ok" : "bad" }), t("panel.pgvector") + (health.pgvectorVersion ? " " + health.pgvectorVersion : "")),
          h("div", { className: "ocChip", title: t("panel.tasks") + " " + ((health.scheduler && health.scheduler.enabled) || 0) + "/" + ((health.scheduler && health.scheduler.registered) || 0) }, h(Dot, { state: health.scheduler ? "ok" : "mute" }), t("panel.tasks") + " " + ((health.scheduler && health.scheduler.enabled) || 0) + "/" + ((health.scheduler && health.scheduler.registered) || 0)),
          h("div", { className: "ocChip", title: t("panel.agents") }, h(Dot, { state: agents.reachable ? (agents.paused ? "mute" : "ok") : "bad" }),
            t("panel.agents") + " " + (agents.reachable ? (agents.paused ? t("panel.agentsPaused") : t("panel.queue") + " " + (agents.queue || 0) + " · " + t("panel.running") + " " + (agents.active || 0)) : "—"))),
        h(ErrLine, { error: dashS[0].error || healthS[0].error, onRetry: reloadAll }),
        dash ? h("div", { style: { display: "flex", flexDirection: "column", gap: 12 } },
          groupOrder.map(function (g) {
            return h("div", { key: g },
              h("div", { className: "ocH", style: { marginBottom: 6 } }, groupLabel(g)),
              h("div", { className: "ocMetrics" }, groups[g].map(function (m) {
                return h("div", { className: "ocMetric", key: m.id, title: m.source || "" },
                  h("span", null, m.label), h("b", null, fmtNum(m.value) + (m.unit ? " " + m.unit : "")));
              })));
          }),
          dash.frozen && dash.frozen.count > 0 ? h("div", { className: "ocFrozen" }, t("panel.frozen") + " " + dash.frozen.count + " · " + fmtNum(dash.frozen.amount) + "（" + t("panel.frozenHint") + "）") : null)
          : dashS[0].loading ? h("div", { className: "ocMetrics", role: "status", "aria-busy": "true", "aria-label": t("panel.loading") },
            [0, 1, 2, 3, 4, 5].map(function (i) { return h("div", { className: "ocMetric", key: i }, h("span", { className: "ocSkel", style: { width: "52%", display: "block" } }), h("span", { className: "ocSkel", style: { width: "72%", height: 22, display: "block", marginTop: 8 } })); }))
          : h(EmptyState, { title: "暂无经营指标", hint: "确认数据库连接与驾驶舱聚合服务后重试。", icon: "grid" }),
        h("div", { className: "ocSection" },
          h("div", { className: "ocH" }, "晨报", h("span", { className: "ocCount" }, report.data ? fmtTime(report.data.sent_at) : "")),
          report.error ? h("div", { className: "ocEmpty" }, report.error) : null,
          report.data ? h("pre", { className: "ocMono", style: { whiteSpace: "pre-wrap", margin: 0, overflow: "auto", maxHeight: 300 } }, JSON.stringify(report.data.content, null, 2)) : h("div", { className: "ocSkelRow", role: "status", "aria-busy": "true", "aria-label": t("panel.loading") }, h("span", { className: "ocSkel", style: { width: "70%" } }))),
        h("div", { className: "ocFoot" },
          dash ? h("span", null, t("panel.asOf") + " " + fmtTime(dash.asOf)) : null,
          dash && dash.stale ? h("span", null, "⚠ " + t("panel.stale")) : null,
          dash && dash.warnings && dash.warnings.length ? h("span", null, dash.warnings.join("；")) : null));
    }

    // ================= 员工矩阵 =================
    function EmployeesTab(props) {
      var empS = useLoad(function () { return apiGet("/employees"); }, []);
      var runsS = useLoad(function () { return apiGet("/agents/runs"); }, []);
      var healthS = useLoad(function () { return apiGet("/agents/health"); }, []);
      var dispatchS = react.useState({ pluginId: "", prompt: "" });
      var dispatch = dispatchS[0], setDispatch = dispatchS[1];
      var importS = react.useState({ text: "" });
      var imp = importS[0], setImp = importS[1];
      var busyS = react.useState(false);
      var busy = busyS[0], setBusy = busyS[1];
      function run(promise, okMsg) {
        setBusy(true);
        promise.then(function () { props.flash(okMsg || "OK", true); empS[1](); runsS[1](); healthS[1](); })
          .catch(function (e) { props.flash(String((e && e.message) || e), false); })
          .then(function () { setBusy(false); });
      }
      var data = empS[0].data || {};
      var catalog = data.catalog || [];
      var installed = data.items || [];
      var installedMap = {};
      installed.forEach(function (it) { installedMap[it.pluginId] = it; });
      var runs = (runsS[0].data && runsS[0].data.items) || [];
      var agents = healthS[0].data || {};

      var cols = [
        { key: "name", label: "员工", render: function (r) { return h("span", null, h("b", null, r.displayName), h("span", { className: "ocMono" }, " " + r.employeeCode)); } },
        { key: "pluginId", label: "插件", render: function (r) { return h("span", { className: "ocMono" }, r.pluginId); } },
        { key: "version", label: "版本", render: function (r) { return h("span", { className: "ocMono" }, r.version); } },
        { key: "counts", label: "视图/工具/写目标", render: function (r) { return h("span", { className: "ocMono" }, r.requiredViews.length + " / " + r.tools.length + " / " + r.writeTargets.length); } },
        { key: "singleWorkflows", label: "单员工流程", render: function (r) { return h("span", { className: "ocMono" }, r.singleWorkflows.join(", ") || "-"); } },
        { key: "status", label: "状态", render: function (r) { var it = installedMap[r.pluginId]; return it ? h(Badge, { tone: it.enabled ? "ok" : "warn" }, it.enabled ? t("panel.enabled") : t("panel.disabled")) : h(Badge, { tone: "mute" }, "未安装"); } },
        { key: "ops", label: "操作", render: function (r) {
            var it = installedMap[r.pluginId];
            var buttons = [
              h(Btn, { key: "install", onClick: function () { run(apiPost("/employees", { manifest: r, enabled: true }), "已安装 " + r.displayName); } }, it ? "重装" : t("panel.install")),
              h(Btn, { key: "deploy", onClick: function () { run(apiPost("/agents/deploy", { pluginId: r.pluginId }), "已部署角色卡 " + r.displayName); } }, t("panel.deploy")),
            ];
            if (it) {
              buttons.push(
                h(Btn, { key: "toggle", onClick: function () { run(apiPost("/employees/" + encodeURIComponent(r.pluginId) + "/toggle", { enabled: !it.enabled, reason: "面板操作" }), it.enabled ? "已停用" : "已启用"); } }, it.enabled ? t("panel.disabled") : t("panel.enabled")),
                h(Btn, { key: "export", onClick: function () { run(apiPost("/employees/" + encodeURIComponent(r.pluginId) + "/export", { actor: "boss" }), "已导出员工包"); } }, t("panel.exportPkg")));
            }
            return h("div", { className: "ocRow" }, buttons);
          } },
      ];
      var runCols = [
        { key: "id", label: "runId", render: function (r) { return h("span", { className: "ocMono" }, r.id); } },
        { key: "agentName", label: "员工", render: function (r) { return h("span", null, r.agentName || r.agentId); } },
        { key: "kind", label: "触发", render: function (r) { return h("span", { className: "ocMono" }, r.kind || "-"); } },
        { key: "status", label: "状态", render: function (r) { return h(Badge, { tone: r.status === "done" ? "ok" : r.status === "failed" || r.status === "timeout" ? "bad" : "mute" }, r.status); } },
        { key: "createdAt", label: "开始", render: function (r) { return h("span", { className: "ocMono" }, fmtTime(r.createdAt)); } },
        { key: "taskText", label: "任务", render: function (r) { return h("span", { className: "ocEllip", title: r.taskText || "" }, short(r.taskText, 60)); } },
      ];
      return h(Fragment, null,
        h(PageHeader, { title: "员工矩阵", subtitle: "共 " + catalog.length + " 个员工 · 已安装 " + installed.length },
          h(Badge, { tone: agents.reachable ? (agents.paused ? "warn" : "ok") : "bad" }, "智能体 " + (agents.reachable ? (agents.paused ? "已暂停" : "可达") : "不可达")),
          h(Btn, { onClick: function () { empS[1](); runsS[1](); healthS[1](); } }, h(Icon, { name: "refresh", size: 14 }), t("panel.refresh"))),
        h(ErrLine, { error: empS[0].error || runsS[0].error, onRetry: function () { empS[1](); runsS[1](); healthS[1](); } }),
        h(Card, null,
          h("div", { className: "ocH" }, "员工目录", h("span", { className: "ocCount" }, String(catalog.length))),
          h(Table, { columns: cols, rows: catalog, loading: empS[0].loading, empty: "暂无员工目录", emptyHint: "导入员工包后，员工会在这里出现。", emptyIcon: "users" })),
        h("div", { className: "ocSection" },
          h("div", { className: "ocH" }, t("panel.dispatch")),
          h("div", { className: "ocFormRow" },
            h(Select, { label: t("panel.dispatchFor"), value: dispatch.pluginId, options: [{ value: "", label: "选择员工" }].concat(catalog.map(function (r) { return { value: r.pluginId, label: r.displayName }; })), onChange: function (v) { setDispatch({ pluginId: v, prompt: dispatch.prompt }); } }),
            h("div", { style: { flex: 3 } }, h(Field, { label: "任务", value: dispatch.prompt, placeholder: t("panel.taskPlaceholder"), onChange: function (v) { setDispatch({ pluginId: dispatch.pluginId, prompt: v }); } })),
            h(Btn, { kind: "primary", disabled: busy || !dispatch.pluginId || !dispatch.prompt.trim(), onClick: function () { run(apiPost("/agents/dispatch", { pluginId: dispatch.pluginId, prompt: dispatch.prompt }), "已派活"); setDispatch({ pluginId: dispatch.pluginId, prompt: "" }); } }, t("panel.dispatch"))),
          h("div", { className: "ocMuted" }, "认知任务在员工超级智能体会话中执行，产物文件回传运行记录；需先部署角色卡。")),
        h(Card, null,
          h("div", { className: "ocH" }, t("panel.runs"), h("span", { className: "ocCount" }, String(runs.length))),
          h(Table, { columns: runCols, rows: runs, loading: runsS[0].loading, empty: "暂无运行记录", emptyHint: "派活或调度任务触发后会在这里留下运行记录。", emptyIcon: "clock" })),
        h("div", { className: "ocSection" },
          h("div", { className: "ocH" }, t("panel.import")),
          h(Area, { label: "员工包 JSON（先预检再导入）", value: imp.text, onChange: function (v) { setImp({ text: v }); } }),
          h("div", { className: "ocRow" },
            h(Btn, { disabled: busy || !imp.text.trim(), onClick: function () { run(apiPost("/employees/import", { package: parseJson(imp.text, {}), dryRun: true }), "预检完成"); } }, "预检"),
            h(Btn, { kind: "primary", disabled: busy || !imp.text.trim(), onClick: function () { run(apiPost("/employees/import", { package: parseJson(imp.text, {}), dryRun: false, confirm: true }), "导入完成（默认停用）"); } }, "确认导入"))));
    }

    // ================= 业务域 =================
    var DOMAINS = [
      { id: "finance", name: "财税", code: "FIN", views: ["view_ar_ap", "view_company_profile"], desc: "账簿、报销、税历、报表、分析" },
      { id: "legal", name: "法务", code: "LEG", views: ["view_contract_index", "view_customer_base"], desc: "合同、风险、案件、知识产权、合规" },
      { id: "admin", name: "行政", code: "ADM", views: ["view_company_profile"], desc: "会议、公文、印章、证照、资产、采购" },
      { id: "strategy", name: "战略", code: "STR", views: ["view_okr", "view_company_profile"], desc: "目标、决策、规划、预算、复盘" },
      { id: "project", name: "项目", code: "PRJ", views: ["view_project_status"], desc: "立项、计划、里程碑、变更、验收" },
      { id: "intel", name: "情报", code: "INT", views: [], desc: "线索、尽调、情报、供应商风险、监控" },
      { id: "crm", name: "客户", code: "CRM", views: ["view_customer_base"], desc: "客户、联系人、承诺、报价" },
      { id: "inventory", name: "货栈", code: "INV", views: ["view_stock_index"], desc: "SKU、库存、出入库、对账" },
      { id: "vehicle", name: "车务", code: "VEH", views: ["view_vehicle_index"], desc: "车辆、用车、费用、补贴" },
      { id: "wbs", name: "WBS", code: "WBS", views: ["view_project_status"], desc: "工作包、进度、逾期、外协" },
      { id: "publicity", name: "外宣", code: "PUB", views: [], desc: "内容、渠道、发布、舆情" },
    ];
    function DomainsTab(props) {
      var dashS = useLoad(function () { return apiGet("/web/dashboard" + qs({ range: "30d" })); }, []);
      var dash = dashS[0].data;
      var groups = {};
      if (dash && dash.metrics) dash.metrics.forEach(function (m) { (groups[m.group] = groups[m.group] || []).push(m); });
      return h(Fragment, null,
        h(PageHeader, { title: "业务域", subtitle: "9 个经营域 + 平台域，指标来自驾驶舱聚合（只读）" },
          h(Btn, { onClick: function () { dashS[1](); } }, h(Icon, { name: "refresh", size: 14 }), t("panel.refresh"))),
        h(ErrLine, { error: dashS[0].error, onRetry: function () { dashS[1](); } }),
        dashS[0].loading && !dash
          ? h("div", { className: "ocGrid2", role: "status", "aria-busy": "true", "aria-label": t("panel.loading") },
              [0, 1, 2, 3].map(function (i) {
                return h("div", { className: "ocDomain", key: i },
                  h("div", { className: "ocDomainName" }, h("span", { className: "ocSkel", style: { width: "42%" } })),
                  h("div", { className: "ocMetrics" }, [0, 1].map(function (j) { return h("div", { className: "ocMetric", key: j }, h("span", { className: "ocSkel", style: { width: "60%", display: "block" } }), h("span", { className: "ocSkel", style: { width: "80%", height: 20, display: "block", marginTop: 8 } })); })));
              }))
          : h("div", { className: "ocGrid2" }, DOMAINS.map(function (d) {
              var ms = groups[d.id] || [];
              return h("div", { className: "ocDomain", key: d.id },
                h("div", { className: "ocDomainName" }, d.name, h("span", null, d.code + " · " + d.desc)),
                ms.length ? h("div", { className: "ocMetrics" }, ms.map(function (m) {
                  return h("div", { className: "ocMetric", key: m.id, title: m.source || "" }, h("span", null, m.label), h("b", null, fmtNum(m.value) + (m.unit ? " " + m.unit : "")));
                })) : h("div", { className: "ocEmpty" }, "本域暂无聚合指标"),
                h("div", { className: "ocMuted" }, "授权视图：" + (d.views.length ? d.views.join("、") : "（敏感/汇总在其他域）")));
            })));
    }

    // ================= 流程 =================
    function WorkflowInstances(props) {
      var instS = useLoad(function () { return apiGet("/workflows/" + encodeURIComponent(props.workflowId) + "/instances"); }, [props.workflowId]);
      var detailS = react.useState(null);
      var detail = detailS[0], setDetail = detailS[1];
      var busyS = react.useState(false);
      var busy = busyS[0], setBusy = busyS[1];
      function act(promise, ok) {
        setBusy(true);
        promise.then(function () { props.flash(ok, true); instS[1](); })
          .catch(function (e) { props.flash(String((e && e.message) || e), false); })
          .then(function () { setBusy(false); });
      }
      var items = (instS[0].data && instS[0].data.items) || [];
      var cols = [
        { key: "id", label: "#", render: function (r) { return h("span", { className: "ocMono" }, String(r.id)); } },
        { key: "version", label: "版本", render: function (r) { return h("span", { className: "ocMono" }, r.version); } },
        { key: "status", label: "状态", render: function (r) { return h(Badge, { tone: r.status === "completed" ? "ok" : r.status === "failed" ? "bad" : "mute" }, r.status); } },
        { key: "started_at", label: "开始", render: function (r) { return h("span", { className: "ocMono" }, fmtTime(r.started_at)); } },
        { key: "ops", label: "操作", render: function (r) { return h(Btn, { onClick: function () { setDetail(r.id); } }, t("panel.detail")); } },
      ];
      return h(Fragment, null,
        h(PageHeader, { title: "流程实例", subtitle: short(props.workflowId, 60) },
          h(Btn, { onClick: props.onBack }, h(Icon, { name: "back", size: 14 }), t("panel.back")),
          h(Btn, { onClick: function () { instS[1](); } }, h(Icon, { name: "refresh", size: 14 }), t("panel.refresh")),
          h(Btn, { kind: "primary", disabled: busy, onClick: function () { act(apiPost("/workflows/" + encodeURIComponent(props.workflowId) + "/instances", { context: {} }), "实例已启动"); } }, t("panel.start"))),
        h(ErrLine, { error: instS[0].error, onRetry: function () { instS[1](); } }),
        h(Table, { columns: cols, rows: items, loading: instS[0].loading, empty: "该流程还没有实例", emptyHint: "点击「启动实例」创建第一个运行实例。", emptyIcon: "flow" }),
        detail !== null ? h(InstanceDetail, { instanceId: detail, onClose: function () { setDetail(null); }, flash: props.flash }) : null);
    }

    function InstanceDetail(props) {
      var detS = useLoad(function () { return apiGet("/instances/" + props.instanceId); }, [props.instanceId]);
      var nodeS = react.useState({ nodeId: "", payload: "{}" });
      var nodeForm = nodeS[0], setNodeForm = nodeS[1];
      var verdictS = react.useState({ nodeId: "", samples: "pass,pass,pass", highImpact: false });
      var verdict = verdictS[0], setVerdict = verdictS[1];
      var busyS = react.useState(false);
      var busy = busyS[0], setBusy = busyS[1];
      function act(promise, ok) {
        setBusy(true);
        promise.then(function () { props.flash(ok, true); detS[1](); })
          .catch(function (e) { props.flash(String((e && e.message) || e), false); })
          .then(function () { setBusy(false); });
      }
      var d = detS[0].data;
      var inst = (d && d.instance) || {};
      var nodes = (d && d.nodes) || [];
      var nodeCols = [
        { key: "node_id", label: "节点", render: function (r) { return h("span", { className: "ocMono" }, r.node_id); } },
        { key: "status", label: "状态", render: function (r) { return h(Badge, { tone: "ok" }, r.status); } },
        { key: "idempotency_key", label: "幂等键", render: function (r) { return h("span", { className: "ocMono" }, short(r.idempotency_key, 24)); } },
        { key: "output", label: "输出", render: function (r) { return h("span", { className: "ocEllip", title: fmtVal(r.output) }, short(r.output, 50)); } },
      ];
      return h("div", { className: "ocSection" },
        h(PageHeader, { title: "实例 #" + props.instanceId, subtitle: (inst.workflow_id || "") + "@" + (inst.version || "") },
          inst.status ? h(Badge, { tone: inst.status === "completed" ? "ok" : inst.status === "failed" ? "bad" : "mute" }, inst.status) : null,
          h(Btn, { onClick: props.onClose, ariaLabel: t("panel.cancel") }, h(Icon, { name: "x", size: 14 }), t("panel.cancel"))),
        h(Table, { columns: nodeCols, rows: nodes, loading: detS[0].loading, empty: "暂无节点", emptyHint: "节点在被执行或完成后会出现在这里。", emptyIcon: "flow" }),
        h("div", { className: "ocFormRow" },
          h(Field, { label: "节点 ID", value: nodeForm.nodeId, onChange: function (v) { setNodeForm({ nodeId: v, payload: nodeForm.payload }); } }),
          h(Area, { label: "节点输出 JSON", value: nodeForm.payload, onChange: function (v) { setNodeForm({ nodeId: nodeForm.nodeId, payload: v }); } }),
          h(Btn, { kind: "primary", disabled: busy || !nodeForm.nodeId, onClick: function () { act(apiPost("/instances/" + props.instanceId + "/nodes/" + encodeURIComponent(nodeForm.nodeId) + "/complete", { payload: parseJson(nodeForm.payload, {}) }), "节点已完成"); } }, t("panel.completeNode"))),
        h("div", { className: "ocFormRow" },
          h(Field, { label: "评判节点 ID", value: verdict.nodeId, onChange: function (v) { setVerdict({ nodeId: v, samples: verdict.samples, highImpact: verdict.highImpact }); } }),
          h(Field, { label: "pass/fail 样本（逗号）", value: verdict.samples, onChange: function (v) { setVerdict({ nodeId: verdict.nodeId, samples: v, highImpact: verdict.highImpact }); } }),
          h(Btn, { kind: "primary", disabled: busy || !verdict.nodeId, onClick: function () {
              var samples = verdict.samples.split(",").map(function (x) { return x.trim(); }).filter(function (x) { return x === "pass" || x === "fail"; });
              act(apiPost("/instances/" + props.instanceId + "/nodes/" + encodeURIComponent(verdict.nodeId) + "/verdict", { samples: samples, highImpact: verdict.highImpact }), "评判已记录");
            } }, t("panel.verdict"))));
    }

    function WorkflowsTab(props) {
      var listS = useLoad(function () { return apiGet("/workflows"); }, []);
      var selS = react.useState("");
      var selected = selS[0], setSelected = selS[1];
      var regS = react.useState({ workflowId: "", version: "1.0.0", ownerPlugin: "", code: "export const meta = {};", testedCodeHash: "", meta: "{}", monthlyFlow: 30 });
      var reg = regS[0], setReg = regS[1];
      var showS = react.useState(false);
      var show = showS[0], setShow = showS[1];
      var busyS = react.useState(false);
      var busy = busyS[0], setBusy = busyS[1];
      var empS = useLoad(function () { return apiGet("/employees"); }, []);
      var employees = ((empS[0].data && empS[0].data.catalog) || []).map(function (r) { return { value: r.pluginId, label: r.displayName }; });
      function act(promise, ok) {
        setBusy(true);
        promise.then(function () { props.flash(ok, true); listS[1](); })
          .catch(function (e) { props.flash(String((e && e.message) || e), false); })
          .then(function () { setBusy(false); });
      }
      var workflows = (listS[0].data && listS[0].data.workflows) || [];
      if (selected) return h(WorkflowInstances, { workflowId: selected, onBack: function () { setSelected(""); listS[1](); }, flash: props.flash });
      var cols = [
        { key: "workflow_id", label: "流程", render: function (r) { return h("span", null, h("b", null, r.workflow_id), h("span", { className: "ocMono" }, " @" + r.version)); } },
        { key: "owner_plugin", label: "负责员工", render: function (r) { return h("span", { className: "ocMono" }, r.owner_plugin); } },
        { key: "scope", label: "范围", render: function (r) { return h("span", { className: "ocMono" }, r.scope); } },
        { key: "risk_level", label: "风险", render: function (r) { return h(Badge, { tone: r.risk_level === "high" ? "bad" : r.risk_level === "medium" ? "warn" : "ok" }, r.risk_level); } },
        { key: "status", label: "状态", render: function (r) { return h("span", { className: "ocMono" }, r.status); } },
        { key: "ops", label: "操作", render: function (r) { return h(Btn, { onClick: function () { setSelected(r.workflow_id); } }, "实例"); } },
      ];
      var sample = {
        id: "tax_monthly_prepare", version: "1.0.0", name: "月度税务申报准备", owner_plugin: "opc_finance", scope: "single",
        required_views: ["view_ar_ap"], key_nodes: ["collect_invoices", "reconcile", "tax_calc", "review_gate"], human_gates: ["review_gate"],
        deadline_impact: true, idempotent_nodes: ["write_ledger"], write_nodes: ["write_ledger"], tools: ["opc_ledger_write"],
        verifier_policy: { reconcile: { sampling: 3 } },
      };
      return h(Fragment, null,
        h(PageHeader, { title: "流程", subtitle: "注册表共 " + workflows.length + " 个版本 · 六项准入守卫 + 风险硬规则" },
          h(Btn, { onClick: function () { setShow(!show); } }, t("panel.register")),
          h(Btn, { onClick: function () { listS[1](); } }, h(Icon, { name: "refresh", size: 14 }), t("panel.refresh"))),
        h(ErrLine, { error: listS[0].error, onRetry: function () { listS[1](); } }),
        h(Table, { columns: cols, rows: workflows, loading: listS[0].loading, empty: "还没有注册流程", emptyHint: "点击「注册流程」按准入守卫提交第一个流程。", emptyIcon: "flow" }),
        show ? h("div", { className: "ocSection" },
          h("div", { className: "ocH" }, t("panel.register") + "（六项准入守卫 + 风险硬规则）"),
          h("div", { className: "ocFormRow" },
            h(Field, { label: "workflowId", value: reg.workflowId, onChange: function (v) { setReg(Object.assign({}, reg, { workflowId: v })); } }),
            h(Field, { label: "version", value: reg.version, onChange: function (v) { setReg(Object.assign({}, reg, { version: v })); } }),
            h(Select, { label: "ownerPlugin", value: reg.ownerPlugin, options: [{ value: "", label: "选择员工" }].concat(employees), onChange: function (v) { setReg(Object.assign({}, reg, { ownerPlugin: v })); } }),
            h(NumField, { label: "monthlyFlow", value: reg.monthlyFlow, onChange: function (v) { setReg(Object.assign({}, reg, { monthlyFlow: v })); } })),
          h(Field, { label: "testedCodeHash（sha256）", value: reg.testedCodeHash, onChange: function (v) { setReg(Object.assign({}, reg, { testedCodeHash: v })); } }),
          h(Area, { label: "meta JSON", value: reg.meta, onChange: function (v) { setReg(Object.assign({}, reg, { meta: v })); } }),
          h(Area, { label: "code", value: reg.code, rows: 5, onChange: function (v) { setReg(Object.assign({}, reg, { code: v })); } }),
          h("div", { className: "ocRow" },
            h(Btn, { onClick: function () { setReg(Object.assign({}, reg, { code: "export const meta = " + JSON.stringify(sample) + ";" })); } }, "填充示例"),
            h(Btn, { kind: "primary", disabled: busy || !reg.workflowId || !reg.ownerPlugin, onClick: function () {
                act(apiPost("/workflows", { workflowId: reg.workflowId, version: reg.version, ownerPlugin: reg.ownerPlugin, meta: parseJson(reg.meta, {}), code: reg.code, testedCodeHash: reg.testedCodeHash, monthlyFlow: reg.monthlyFlow }), "流程已注册");
              } }, t("panel.register")))) : null);
    }

    // ================= 任务 =================
    function TasksTab(props) {
      var listS = useLoad(function () { return apiGet("/tasks"); }, []);
      var busyS = react.useState(false);
      var busy = busyS[0], setBusy = busyS[1];
      function act(promise, ok) {
        setBusy(true);
        promise.then(function () { props.flash(ok, true); listS[1](); })
          .catch(function (e) { props.flash(String((e && e.message) || e), false); })
          .then(function () { setBusy(false); });
      }
      var tasks = (listS[0].data && listS[0].data.tasks) || [];
      var cols = [
        { key: "taskId", label: "任务", render: function (r) { return h("span", null, h("b", null, r.name || r.taskId), h("span", { className: "ocMono" }, " " + r.taskId)); } },
        { key: "cron", label: "cron", render: function (r) { return h("span", { className: "ocMono" }, r.cron + " @ " + r.timezone); } },
        { key: "enabled", label: "启用", render: function (r) { return h(Badge, { tone: r.enabled ? "ok" : "mute" }, r.enabled ? "是" : "否"); } },
        { key: "nextRunAt", label: t("panel.next"), render: function (r) { return h("span", { className: "ocMono" }, fmtTime(r.nextRunAt)); } },
        { key: "lastRunStatus", label: "上次", render: function (r) { return h("span", { className: "ocMono" }, (r.lastRunStatus || "-") + " " + (r.lastRunAt ? fmtTime(r.lastRunAt) : "")); } },
        { key: "ops", label: "操作", render: function (r) {
            return h("div", { className: "ocRow" },
              h(Btn, { disabled: busy, onClick: function () { act(apiPost("/tasks/" + encodeURIComponent(r.taskId) + "/run", { force: true }), "已触发 " + r.taskId); } }, t("panel.run")),
              h(Btn, { disabled: busy, onClick: function () { act(apiPut("/tasks/" + encodeURIComponent(r.taskId), { cron: r.cron, timezone: r.timezone, enabled: !r.enabled, config: r.config || {} }), r.enabled ? "已停用" : "已启用"); } }, r.enabled ? t("panel.disabled") : t("panel.enabled")));
          } },
      ];
      return h(Fragment, null,
        h(PageHeader, { title: "任务", subtitle: "定时任务 " + tasks.length + " 个 · cron + 时区 + 幂等执行" },
          h(Btn, { onClick: function () { listS[1](); } }, h(Icon, { name: "refresh", size: 14 }), t("panel.refresh"))),
        h(ErrLine, { error: listS[0].error, onRetry: function () { listS[1](); } }),
        h(Table, { columns: cols, rows: tasks, loading: listS[0].loading, empty: "暂无定时任务", emptyHint: "调度任务初始化后会出现在这里。", emptyIcon: "clock" }));
    }

    // ================= 审计 =================
    function AuditsTab(props) {
      var filterS = react.useState({ action: "", limit: 50 });
      var filter = filterS[0], setFilter = filterS[1];
      var listS = useLoad(function () { return apiGet("/audits" + qs({ action: filter.action, limit: filter.limit })); }, [filter.action, filter.limit]);
      var expS = react.useState({ outDir: "", sinceId: "" });
      var exp = expS[0], setExp = expS[1];
      var busyS = react.useState(false);
      var busy = busyS[0], setBusy = busyS[1];
      function act(promise, ok) {
        setBusy(true);
        promise.then(function () { props.flash(ok, true); listS[1](); })
          .catch(function (e) { props.flash(String((e && e.message) || e), false); })
          .then(function () { setBusy(false); });
      }
      var rows = (listS[0].data && listS[0].data.rows) || (Array.isArray(listS[0].data) ? listS[0].data : []) || [];
      var cols = [
        { key: "id", label: "#", render: function (r) { return h("span", { className: "ocMono" }, String(r.id || "")); } },
        { key: "created_at", label: "时间", render: function (r) { return h("span", { className: "ocMono" }, fmtTime(r.created_at)); } },
        { key: "actor", label: "主体", render: function (r) { return h("span", { className: "ocMono" }, r.actor); } },
        { key: "action", label: "动作", render: function (r) { return h("span", { className: "ocMono" }, r.action); } },
        { key: "result", label: "结果", render: function (r) { return h(Badge, { tone: r.result === "ok" ? "ok" : r.result === "denied" ? "warn" : "bad" }, r.result); } },
        { key: "object_id", label: "对象", render: function (r) { return h("span", { className: "ocMono" }, short((r.object_type || "") + ":" + (r.object_id || ""), 30)); } },
        { key: "hash", label: "哈希链", render: function (r) { return h("span", { className: "ocMono" }, short(r.hash || "", 12)); } },
      ];
      return h(Fragment, null,
        h(PageHeader, { title: "审计", subtitle: "哈希链留痕 · 按动作过滤 · JSONL 导出" },
          h(Btn, { onClick: function () { listS[1](); } }, h(Icon, { name: "refresh", size: 14 }), t("panel.refresh"))),
        h("div", { className: "ocFormRow" },
          h(Field, { label: "动作过滤", value: filter.action, onChange: function (v) { setFilter(Object.assign({}, filter, { action: v })); } }),
          h(NumField, { label: "条数", value: filter.limit, onChange: function (v) { setFilter(Object.assign({}, filter, { limit: v })); } })),
        h(ErrLine, { error: listS[0].error, onRetry: function () { listS[1](); } }),
        h(Table, { columns: cols, rows: rows, loading: listS[0].loading, empty: "暂无审计记录", emptyHint: "有写操作或裁决后会留下不可篡改的审计记录。", emptyIcon: "shield" }),
        h("div", { className: "ocSection" },
          h("div", { className: "ocH" }, t("panel.export") + "（JSONL + SHA-256 + 链头）"),
          h("div", { className: "ocFormRow" },
            h(Field, { label: "outDir（留空用归档目录）", value: exp.outDir, onChange: function (v) { setExp(Object.assign({}, exp, { outDir: v })); } }),
            h(Field, { label: "sinceId", value: exp.sinceId, onChange: function (v) { setExp(Object.assign({}, exp, { sinceId: v })); } }),
            h(Btn, { kind: "primary", disabled: busy, onClick: function () { act(apiPost("/audits/export", { outDir: exp.outDir || undefined, sinceId: exp.sinceId === "" ? undefined : Number(exp.sinceId) }), "已导出"); } }, t("panel.export")))));
    }

    // ================= 冲突 =================
    function ConflictsTab(props) {
      var listS = useLoad(function () { return apiGet("/conflicts"); }, []);
      var resS = react.useState({ id: "", choice: "A", note: "" });
      var res = resS[0], setRes = resS[1];
      var busyS = react.useState(false);
      var busy = busyS[0], setBusy = busyS[1];
      function act(promise, ok) {
        setBusy(true);
        promise.then(function () { props.flash(ok, true); listS[1](); })
          .catch(function (e) { props.flash(String((e && e.message) || e), false); })
          .then(function () { setBusy(false); });
      }
      var items = (listS[0].data && listS[0].data.items) || [];
      var cols = [
        { key: "id", label: "#", render: function (r) { return h("span", { className: "ocMono" }, String(r.id)); } },
        { key: "conflict_type", label: "类型", render: function (r) { return h("span", { className: "ocMono" }, r.conflict_type); } },
        { key: "frozen_unit_type", label: "冻结单元", render: function (r) { return h("span", { className: "ocMono" }, r.frozen_unit_type + "#" + r.frozen_unit_id); } },
        { key: "parties", label: "各方", render: function (r) { return h("span", { className: "ocEllip", title: fmtVal(r.parties) }, short(r.parties, 40)); } },
        { key: "status", label: "状态", render: function (r) { return h(Badge, { tone: r.status === "resolved" ? "ok" : r.status === "open" ? "warn" : "mute" }, r.status); } },
        { key: "detected_at", label: "检出", render: function (r) { return h("span", { className: "ocMono" }, fmtTime(r.detected_at)); } },
        { key: "ops", label: "操作", render: function (r) { return h(Btn, { onClick: function () { setRes({ id: String(r.id), choice: "A", note: "" }); } }, t("panel.resolve")); } },
      ];
      return h(Fragment, null,
        h(PageHeader, { title: "冲突", subtitle: "冲突队列 " + items.length + " 条 · 冻结单元不入有效汇总，总额含冻结" },
          h(Btn, { onClick: function () { listS[1](); } }, h(Icon, { name: "refresh", size: 14 }), t("panel.refresh"))),
        h(ErrLine, { error: listS[0].error, onRetry: function () { listS[1](); } }),
        h(Table, { columns: cols, rows: items, loading: listS[0].loading, empty: "暂无冲突", emptyHint: "检测到跨域单元冲突时会在此排队等待裁决。", emptyIcon: "alert" }),
        h("div", { className: "ocSection" },
          h("div", { className: "ocH" }, t("panel.resolve")),
          h("div", { className: "ocFormRow" },
            h(Field, { label: "冲突 #", value: res.id, onChange: function (v) { setRes(Object.assign({}, res, { id: v })); } }),
            h(Select, { label: "裁决", value: res.choice, options: [{ value: "A", label: "A" }, { value: "B", label: "B" }, { value: "manual", label: "manual" }, { value: "later", label: "later" }], onChange: function (v) { setRes(Object.assign({}, res, { choice: v })); } }),
            h(Field, { label: "备注", value: res.note, onChange: function (v) { setRes(Object.assign({}, res, { note: v })); } }),
            h(Btn, { kind: "primary", disabled: busy || !res.id, onClick: function () { act(apiPost("/conflicts/" + encodeURIComponent(res.id) + "/resolve", { choice: res.choice, note: res.note }), "已裁决"); } }, t("panel.resolve")))));
    }

    // ================= 收件箱 =================
    function InboxTab(props) {
      var listS = useLoad(function () { return apiGet("/web/inbox?limit=100"); }, []);
      var ingS = react.useState({ sourceType: "manual", sourceRef: "", text: "" });
      var ing = ingS[0], setIng = ingS[1];
      var busyS = react.useState(false);
      var busy = busyS[0], setBusy = busyS[1];
      function act(promise, ok) {
        setBusy(true);
        promise.then(function () { props.flash(ok, true); listS[1](); })
          .catch(function (e) { props.flash(String((e && e.message) || e), false); })
          .then(function () { setBusy(false); });
      }
      var items = (listS[0].data && listS[0].data.items) || [];
      var cols = [
        { key: "id", label: "#", render: function (r) { return h("span", { className: "ocMono" }, String(r.id)); } },
        { key: "source_type", label: "来源", render: function (r) { return h("span", { className: "ocMono" }, r.sourceType); } },
        { key: "rawText", label: "原文", render: function (r) { return h("span", { className: "ocEllip", title: r.rawText || "" }, short(r.rawText, 50)); } },
        { key: "domain", label: "域", render: function (r) { return h("span", { className: "ocMono" }, r.domain || "-"); } },
        { key: "confidence", label: "置信", render: function (r) { return h("span", { className: "ocMono" }, String(r.confidence)); } },
        { key: "status", label: "状态", render: function (r) { return h(Badge, { tone: r.status === "confirmed" ? "ok" : r.status === "ignored" ? "mute" : "warn" }, r.status); } },
        { key: "ops", label: "操作", render: function (r) {
            return h("div", { className: "ocRow" },
              h(Btn, { disabled: busy || r.status === "confirmed" || r.status === "ignored", onClick: function () { act(apiPost("/web/ingest/" + r.id + "/confirm", { action: "confirm" }), "已确认归置"); } }, t("panel.confirm")),
              h(Btn, { disabled: busy || r.status === "confirmed" || r.status === "ignored", onClick: function () { act(apiPost("/web/ingest/" + r.id + "/confirm", { action: "ignore" }), "已忽略"); } }, t("panel.ignore")));
          } },
      ];
      return h(Fragment, null,
        h(PageHeader, { title: "收件箱", subtitle: "待归置 " + items.length + " 条 · 高风险域只生成确认卡，不自动写库" },
          h(Btn, { onClick: function () { listS[1](); } }, h(Icon, { name: "refresh", size: 14 }), t("panel.refresh"))),
        h(ErrLine, { error: listS[0].error, onRetry: function () { listS[1](); } }),
        h(Table, { columns: cols, rows: items, loading: listS[0].loading, empty: "收件箱已清空", emptyHint: "新的消息、文件或语音会先进入这里等待归置。", emptyIcon: "inbox" }),
        h("div", { className: "ocSection" },
          h("div", { className: "ocH" }, "新增归置"),
          h("div", { className: "ocFormRow" },
            h(Select, { label: "来源", value: ing.sourceType, options: [{ value: "manual", label: "manual" }, { value: "session_message", label: "session_message" }, { value: "upload", label: "upload" }, { value: "voice", label: "voice" }], onChange: function (v) { setIng(Object.assign({}, ing, { sourceType: v })); } }),
            h(Field, { label: "sourceRef", value: ing.sourceRef, onChange: function (v) { setIng(Object.assign({}, ing, { sourceRef: v })); } }),
            h(Area, { label: "原文", value: ing.text, onChange: function (v) { setIng(Object.assign({}, ing, { text: v })); } }),
            h(Btn, { kind: "primary", disabled: busy || !ing.text.trim(), onClick: function () { act(apiPost("/web/ingest", { sourceType: ing.sourceType, sourceRef: ing.sourceRef || "panel", text: ing.text }), "已归置"); } }, "归置"))));
    }

    // ================= 记忆 =================
    function MemoryTab(props) {
      var searchS = react.useState({ query: "", purpose: "boss查看", limit: 20, scopes: "" });
      var search = searchS[0], setSearch = searchS[1];
      var resS = react.useState({ loading: false, error: "", data: null });
      var res = resS[0], setRes = resS[1];
      var propS = react.useState({ type: "experience", title: "", content: "", sourceRefs: "", confidence: 0.7 });
      var prop = propS[0], setProp = propS[1];
      var confS = react.useState({ id: "" });
      var conf = confS[0], setConf = confS[1];
      var busyS = react.useState(false);
      var busy = busyS[0], setBusy = busyS[1];
      function act(promise, ok) {
        setBusy(true);
        promise.then(function () { props.flash(ok, true); })
          .catch(function (e) { props.flash(String((e && e.message) || e), false); })
          .then(function () { setBusy(false); });
      }
      function doSearch() {
        setRes({ loading: true, error: "", data: null });
        apiPost("/web/memory/search", { query: search.query, purpose: search.purpose, limit: search.limit, scopes: search.scopes ? search.scopes.split(",").map(function (x) { return x.trim(); }).filter(Boolean) : [] })
          .then(function (d) { setRes({ loading: false, error: "", data: d }); })
          .catch(function (e) { setRes({ loading: false, error: String((e && e.message) || e), data: null }); });
      }
      var cards = (res.data && res.data.cards) || [];
      var cardCols = [
        { key: "id", label: "#", render: function (r) { return h("span", { className: "ocMono" }, String(r.id || "")); } },
        { key: "type", label: "类型", render: function (r) { return h("span", { className: "ocMono" }, r.type || r.scope || ""); } },
        { key: "title", label: "标题", render: function (r) { return h("span", { className: "ocEllip", title: r.title || "" }, short(r.title, 40)); } },
        { key: "content", label: "内容", render: function (r) { return h("span", { className: "ocEllip", title: r.content || "" }, short(r.content, 60)); } },
        { key: "sensitive", label: "敏感", render: function (r) { return h(Badge, { tone: r.sensitive ? "warn" : "mute" }, r.sensitive ? "是" : "否"); } },
      ];
      return h(Fragment, null,
        h(PageHeader, { title: "记忆", subtitle: "按 scope 检索 · 记忆提案需老板确认后落库" }),
        h("div", { className: "ocSection" },
          h("div", { className: "ocH" }, t("panel.search")),
          h("div", { className: "ocFormRow" },
            h(Field, { label: "query", value: search.query, onChange: function (v) { setSearch(Object.assign({}, search, { query: v })); } }),
            h(Field, { label: "scopes（逗号）", value: search.scopes, onChange: function (v) { setSearch(Object.assign({}, search, { scopes: v })); } }),
            h(Field, { label: "purpose", value: search.purpose, onChange: function (v) { setSearch(Object.assign({}, search, { purpose: v })); } }),
            h(Btn, { kind: "primary", disabled: busy || !search.query, onClick: doSearch }, t("panel.search"))),
          h(ErrLine, { error: res.error, onRetry: doSearch }),
          h(Table, { columns: cardCols, rows: cards, loading: res.loading, empty: "未检索到记忆", emptyHint: "输入关键词和 purpose 后点击检索。", emptyIcon: "book" })),
        h("div", { className: "ocSection" },
          h("div", { className: "ocH" }, t("panel.propose") + "（带来源引用；老板确认后落库）"),
          h("div", { className: "ocFormRow" },
            h(Select, { label: "type", value: prop.type, options: [{ value: "company_profile", label: "company_profile" }, { value: "experience", label: "experience" }, { value: "skill", label: "skill" }, { value: "customer", label: "customer" }, { value: "session_digest", label: "session_digest" }], onChange: function (v) { setProp(Object.assign({}, prop, { type: v })); } }),
            h(Field, { label: "title", value: prop.title, onChange: function (v) { setProp(Object.assign({}, prop, { title: v })); } }),
            h(Field, { label: "sourceRefs（逗号）", value: prop.sourceRefs, onChange: function (v) { setProp(Object.assign({}, prop, { sourceRefs: v })); } }),
            h(NumField, { label: "confidence", value: prop.confidence, onChange: function (v) { setProp(Object.assign({}, prop, { confidence: v })); } })),
          h(Area, { label: "content", value: prop.content, onChange: function (v) { setProp(Object.assign({}, prop, { content: v })); } }),
          h(Btn, { kind: "primary", disabled: busy || !prop.title || !prop.content, onClick: function () {
              act(apiPost("/web/memory/propose", { type: prop.type, title: prop.title, content: prop.content, sourceRefs: prop.sourceRefs ? prop.sourceRefs.split(",").map(function (x) { return x.trim(); }).filter(Boolean) : [], confidence: prop.confidence }), "已提交记忆提案");
            } }, t("panel.propose"))),
        h("div", { className: "ocSection" },
          h("div", { className: "ocH" }, t("panel.confirmProposal")),
          h("div", { className: "ocFormRow" },
            h(Field, { label: "提案 #", value: conf.id, onChange: function (v) { setConf({ id: v }); } }),
            h(Btn, { kind: "primary", disabled: busy || !conf.id, onClick: function () { act(apiPost("/web/memory/proposals/" + encodeURIComponent(conf.id) + "/confirm", {}), "提案已确认"); } }, t("panel.confirmProposal")))));
    }

    // ================= 记忆同步（Hindsight） =================
    function HindsightTab(props) {
      var statusS = useLoad(function () { return apiGet("/memory/hindsight"); }, []);
      var listS = useLoad(function () { return apiGet("/memory/hindsight/memories?limit=50"); }, []);
      var importS = react.useState({ text: "" });
      var imp = importS[0];
      var setImp = importS[1];
      var busyS = react.useState(false);
      var busy = busyS[0];
      var setBusy = busyS[1];
      function act(promise, ok) {
        setBusy(true);
        promise
          .then(function (d) { props.flash(ok + (d ? "：" + JSON.stringify(d) : ""), true); statusS[1](); listS[1](); })
          .catch(function (e) { props.flash(String((e && e.message) || e), false); })
          .then(function () { setBusy(false); });
      }
      var st = statusS[0].data || {};
      var stats = st.stats || {};
      var mems = (listS[0].data && listS[0].data.items) || [];
      var cols = [
        { key: "id", label: "#", render: function (r) { return h("span", { className: "ocMono" }, short(r.id, 12)); } },
        { key: "text", label: "内容", render: function (r) { return h("span", { className: "ocEllip", title: r.text || "" }, short(r.text, 60)); } },
        { key: "context", label: "上下文", render: function (r) { return h("span", { className: "ocMono" }, short(r.context || "", 30)); } },
        { key: "tags", label: "标签", render: function (r) { return h("span", { className: "ocMono" }, (r.tags || []).join(", ")); } },
        { key: "date", label: "时间", render: function (r) { return h("span", { className: "ocMono" }, fmtTime(r.date)); } },
        { key: "state", label: "状态", render: function (r) { return h(Badge, { tone: r.state === "valid" ? "ok" : "mute" }, r.state); } },
      ];
      return h(Fragment, null,
        h(PageHeader, { title: "记忆同步", subtitle: "Hindsight 银行 " + (st.bank || "dsh") + " · OPC 记忆卡 " + (st.opcCards || 0) + " · 待确认提案 " + (st.pendingProposals || 0) },
          h(Badge, { tone: st.reachable ? "ok" : "bad" }, st.reachable ? "可达" : "不可达"),
          h(Btn, { onClick: function () { statusS[1](); listS[1](); } }, h(Icon, { name: "refresh", size: 14 }), t("panel.refresh"))),
        h(ErrLine, { error: statusS[0].error || listS[0].error || (st.reachable ? "" : st.error), onRetry: function () { statusS[1](); listS[1](); } }),
        st.reachable && stats
          ? h("div", { className: "ocStrip" },
              h("div", { className: "ocChip" }, h(Dot, { state: "ok" }), "记忆节点 " + (stats.totalNodes || 0)),
              h("div", { className: "ocChip" }, h(Dot, { state: "ok" }), "链接 " + (stats.totalLinks || 0)),
              h("div", { className: "ocChip" }, h(Dot, { state: "ok" }), "文档 " + (stats.totalDocuments || 0)),
              h("div", { className: "ocChip" }, h(Dot, { state: "mute" }), "最后写入 " + fmtTime(stats.lastWriteAt)))
          : null,
        h("div", { className: "ocSection" },
          h("div", { className: "ocH" }, "导入到 Hindsight"),
          h(Area, { label: "记忆项 JSON 数组（[{content, context?, tags?, timestamp?, document_id?}]，也可直接粘一段文本作单条）", value: imp.text, onChange: function (v) { setImp({ text: v }); } }),
          h("div", { className: "ocRow" },
            h(Btn, { kind: "primary", disabled: busy || !imp.text.trim(), onClick: function () {
                var items;
                try {
                  var parsed = JSON.parse(imp.text);
                  items = Array.isArray(parsed) ? parsed : [parsed];
                } catch (e) {
                  items = [{ content: imp.text }];
                }
                act(apiPost("/memory/hindsight/import", { items: items }), "已导入");
              } }, "导入"),
            h(Btn, { disabled: busy, onClick: function () { act(apiPost("/memory/hindsight/sync", { direction: "push" }), "已推送 OPC 记忆卡"); } }, "推送 OPC 记忆卡 →"),
            h(Btn, { disabled: busy, onClick: function () { act(apiPost("/memory/hindsight/sync", { direction: "pull" }), "已拉取为记忆提案"); } }, "← 拉取为记忆提案"),
            h(Btn, { disabled: busy, onClick: function () { act(apiPost("/memory/hindsight/sync", { direction: "both" }), "双向同步完成"); } }, "双向同步"))),
        h("div", { className: "ocSection" },
          h("div", { className: "ocH" }, "Hindsight 记忆", h("span", { className: "ocCount" }, String((listS[0].data && listS[0].data.total) || mems.length))),
          h(Table, { columns: cols, rows: mems, loading: listS[0].loading, empty: "暂无 Hindsight 记忆", emptyHint: "推送 OPC 记忆卡或从 Hindsight 拉取后会在这里显示。", emptyIcon: "sync" })));
    }

    // ================= 雷达 =================
    function RadarTab(props) {
      var listS = useLoad(function () { return apiGet("/web/radar?limit=100"); }, []);
      var items = (listS[0].data && listS[0].data.items) || [];
      var cols = [
        { key: "id", label: "#", render: function (r) { return h("span", { className: "ocMono" }, String(r.id)); } },
        { key: "radarType", label: "类型", render: function (r) { return h("span", { className: "ocMono" }, r.radarType === "keyword" ? "KW" : "PL"); } },
        { key: "title", label: "标题", render: function (r) { return h("span", { className: "ocEllip", title: r.title || "" }, short(r.title, 50)); } },
        { key: "score", label: "分", render: function (r) { return h("span", { className: "ocMono" }, String(r.score)); } },
        { key: "reason", label: "理由", render: function (r) { return h("span", { className: "ocEllip", title: r.reason || "" }, short(r.reason, 40)); } },
        { key: "status", label: "状态", render: function (r) { return h(Badge, { tone: r.status === "new" ? "ok" : "mute" }, r.status); } },
      ];
      return h(Fragment, null,
        h(PageHeader, { title: "雷达", subtitle: "插件/关键词雷达 " + items.length + " 条 · 只推荐不自动安装" },
          h(Btn, { onClick: function () { listS[1](); } }, h(Icon, { name: "refresh", size: 14 }), t("panel.refresh"))),
        h(ErrLine, { error: listS[0].error, onRetry: function () { listS[1](); } }),
        h(Table, { columns: cols, rows: items, loading: listS[0].loading, empty: "暂无雷达推荐", emptyHint: "关键词或插件雷达命中后会在这里给出建议。", emptyIcon: "radar" }));
    }

    // ================= 设置 =================
    function SettingsTab(props) {
      var healthS = useLoad(function () { return apiGet("/agents/health"); }, []);
      var manifestS = useLoad(function () { return apiGet("/web/manifest"); }, []);
      var busyS = react.useState(false);
      var busy = busyS[0], setBusy = busyS[1];
      var agents = healthS[0].data || {};
      var manifest = manifestS[0].data || {};
      function act(promise, ok) {
        setBusy(true);
        promise.then(function () { props.flash(ok, true); healthS[1](); })
          .catch(function (e) { props.flash(String((e && e.message) || e), false); })
          .then(function () { setBusy(false); });
      }
      return h(Fragment, null,
        h(PageHeader, { title: "设置", subtitle: "基础设施健康 · 全局暂停 · 网页表现层 manifest" },
          h(Btn, { onClick: function () { healthS[1](); manifestS[1](); } }, h(Icon, { name: "refresh", size: 14 }), t("panel.refresh"))),
        h(ErrLine, { error: healthS[0].error || manifestS[0].error, onRetry: function () { healthS[1](); manifestS[1](); } }),
        h(Card, null,
          h("div", { className: "ocH" }, "员工智能体（基础设施层 dsh-super-agents）"),
          h("div", { className: "ocRow" },
            h(Dot, { state: agents.reachable ? "ok" : "bad" }),
            h("span", null, agents.reachable ? "可达" : "不可达"),
            h("span", { className: "ocMono" }, "队列 " + (agents.queue || 0) + " · 运行 " + (agents.active || 0) + (agents.paused ? " · 已暂停" : ""))),
          agents.problems && agents.problems.length ? h("div", { className: "ocList" }, agents.problems.map(function (p) { return h("div", { className: "ocMono", key: p.name }, "[" + p.level + "] " + p.name + " " + (p.note || "")); })) : null,
          h("div", { className: "ocRow" },
            h(Btn, { kind: agents.paused ? "primary" : "danger", disabled: busy || !agents.reachable, onClick: function () { act(apiPost("/agents/pause", { paused: !agents.paused }), agents.paused ? "已恢复认知调度" : "已暂停认知调度"); } }, agents.paused ? t("panel.resume") : t("panel.pause"))),
          h("div", { className: "ocMuted" }, t("panel.pauseHint"))),
        h(Card, null,
          h("div", { className: "ocH" }, "网页表现层 manifest"),
          manifestS[0].loading
            ? h("div", { className: "ocTableSkeleton", role: "status", "aria-busy": "true", "aria-label": t("panel.loading") }, [0, 1, 2].map(function (i) { return h("div", { className: "ocSkelRow", key: i }, h("span", { className: "ocSkel", style: { width: (55 + i * 12) + "%" } })); }))
            : h("pre", { className: "ocMono", style: { whiteSpace: "pre-wrap", margin: 0, overflow: "auto", maxHeight: 320 } }, JSON.stringify(manifest, null, 2))),
        h(Card, null,
          h("div", { className: "ocH" }, "说明"),
          h("div", { className: "ocMuted" }, "本面板是 OPC-玄机 的控制台：所有写操作经中枢视图/令牌/流程/审计统一入口，员工不直连数据库。")));
    }

    // ================= 项目管理 =================
    var GROUP_LABELS = {
      finance: "财务", legal: "法务", admin: "行政", strategy: "战略", project: "项目", intel: "情报",
      crm: "客户", inventory: "货栈", vehicle: "车务", wbs: "WBS", publicity: "外宣",
      platform: "平台", workflow: "流程", scheduler: "调度", web: "网站",
    };
    function groupLabel(id) { return GROUP_LABELS[id] || id; }

    function toneOf(value) {
      var v = String(value === null || value === undefined ? "" : value).toLowerCase();
      if (["active", "approved", "achieved", "passed", "sent", "ok", "synced", "resolved", "closed", "ready", "briefed", "acked", "succeeded", "achieved"].indexOf(v) >= 0) return "ok";
      if (["pending", "running", "planned", "in_progress", "draft", "collected", "analyzed", "partial", "queued", "scheduled", "open", "reopened", "new", "auto_draft"].indexOf(v) >= 0) return "warn";
      if (["failed", "blocked", "delayed", "rejected", "error", "timeout", "critical", "high"].indexOf(v) >= 0) return "bad";
      return "mute";
    }

    function fieldOf(fields, key) {
      for (var i = 0; i < fields.length; i += 1) if (fields[i].key === key) return fields[i];
      return { key: key, label: key, type: "text" };
    }

    function formDraft(fields, row) {
      var draft = {};
      for (var i = 0; i < fields.length; i += 1) {
        var field = fields[i];
        var value = row ? row[field.key] : undefined;
        if (value === undefined && field.default !== undefined) value = field.default;
        if (field.type === "json") {
          draft[field.key] = value === undefined || value === null ? "" : typeof value === "string" ? value : JSON.stringify(value, null, 2);
        } else if (field.type === "bool") {
          draft[field.key] = value === false || value === "false" ? "false" : "true";
        } else if (field.type === "date") {
          draft[field.key] = value === undefined || value === null || value === "" ? "" : value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
        } else {
          draft[field.key] = value === undefined || value === null ? "" : String(value);
        }
      }
      return draft;
    }

    function emptyDraft(fields) { return formDraft(fields, null); }

    function payloadFromDraft(fields, draft) {
      var payload = {};
      for (var i = 0; i < fields.length; i += 1) {
        var field = fields[i];
        var raw = draft[field.key];
        if (raw === "" || raw === undefined || raw === null) {
          if (field.required) throw new Error(field.label + " 为必填项");
          continue;
        }
        if (field.type === "json") {
          try { payload[field.key] = JSON.parse(raw); }
          catch (e) { throw new Error(field.label + " 不是合法 JSON"); }
        } else if (field.type === "bool") {
          payload[field.key] = raw === true || raw === "true";
        } else if (field.type === "number" || field.type === "int") {
          var n = Number(raw);
          if (!isFinite(n)) throw new Error(field.label + " 必须是数字");
          payload[field.key] = n;
        } else {
          payload[field.key] = raw;
        }
      }
      return payload;
    }

    function fieldNode(field, value, onChange) {
      if (field.type === "enum") {
        var options = field.options || (field.enum || []).map(function (x) { return { value: x, label: x }; });
        if (!field.required) options = [{ value: "", label: "请选择" }].concat(options);
        return h(Select, { label: field.label, value: value || "", options: options, onChange: onChange });
      }
      if (field.type === "bool") {
        return h(Select, { label: field.label, value: String(value), options: [{ value: "true", label: "启用" }, { value: "false", label: "停用" }], onChange: onChange });
      }
      if (field.type === "json") return h(Area, { label: field.label, value: value || "", rows: 4, onChange: onChange });
      if (field.type === "textarea") return h(Area, { label: field.label, value: value || "", rows: 3, onChange: onChange });
      if (field.type === "number" || field.type === "int") return h(NumField, { label: field.label, value: value === "" ? "" : Number(value), onChange: onChange });
      if (field.type === "date") return h(Field, { label: field.label, type: "date", value: value || "", onChange: onChange });
      return h(Field, { label: field.label, value: value || "", placeholder: field.placeholder || "", onChange: onChange, required: field.required });
    }

    function cellNode(field, row) {
      var value = row[field.key];
      if (value === null || value === undefined || value === "") return h("span", { className: "ocMuted" }, "-");
      if (field.type === "bool") return h(Badge, { tone: value ? "ok" : "mute" }, value ? "是" : "否");
      if (field.type === "enum") return h(Badge, { tone: toneOf(value) }, String(value));
      if (field.type === "date") return h("span", { className: "ocMono" }, String(value).slice(0, 10));
      if (field.type === "json") return h("span", { className: "ocEllip", title: fmtVal(value) }, short(fmtVal(value), 42));
      if (field.type === "number" || field.type === "int") return h("span", { className: "ocMono" }, fmtNum(value));
      if (field.type === "authRef") return h("span", { className: "ocMono" }, String(value));
      if (field.key === "name" || field.key === "title" || field.key === "keyword" || field.key === "version" || field.key === "caseCode") return h("b", null, short(value, 44));
      return h("span", { className: "ocEllip", title: String(value) }, short(value, 44));
    }

    function adminListPath(scope, projectId, resource) {
      if (scope === "project") return "/admin/projects/" + projectId + "/" + resource;
      if (resource === "sources") return "/admin/intel/sources";
      return "/admin/intel/" + resource + (projectId ? qs({ projectId: projectId }) : "");
    }
    function adminCreate(scope, projectId, resource, payload) {
      if (scope === "project") return apiPost("/admin/projects/" + projectId + "/" + resource, payload);
      return apiPost("/admin/intel/" + resource, resource === "sources" ? payload : Object.assign({ projectId: projectId }, payload));
    }
    function adminUpdate(scope, projectId, resource, id, payload) {
      if (scope === "project") return apiPut("/admin/projects/" + projectId + "/" + resource + "/" + id, payload);
      return apiPut("/admin/intel/" + resource + "/" + id, resource === "sources" ? payload : Object.assign({ projectId: projectId }, payload));
    }
    function adminRemove(scope, projectId, resource, id) {
      if (scope === "project") return apiDelete("/admin/projects/" + projectId + "/" + resource + "/" + id);
      return apiDelete("/admin/intel/" + resource + "/" + id + (resource === "sources" || !projectId ? "" : qs({ projectId: projectId })));
    }

    function KpiGrid(props) {
      var items = props.items || [];
      return h("div", { className: "ocMetrics" }, items.map(function (item, index) {
        return h("div", { className: "ocMetric" + (item.tone ? " " + item.tone : ""), key: item.id || index, title: item.hint || "" },
          h("span", null, item.label),
          h("b", null, item.unit === "%" ? fmtNum(item.value) + "%" : fmtNum(item.value) + (item.unit ? " " + item.unit : "")));
      }));
    }

    function EntityForm(props) {
      var draftS = react.useState(formDraft(props.fields, props.initial || {}));
      var draft = draftS[0], setDraft = draftS[1];
      var errS = react.useState("");
      var err = errS[0], setErr = errS[1];
      react.useEffect(function () {
        setDraft(formDraft(props.fields, props.initial || {}));
        setErr("");
      }, [props.formKey]);
      function submit() {
        var payload;
        try { payload = payloadFromDraft(props.fields, draft); }
        catch (e) { setErr(String((e && e.message) || e)); return; }
        setErr("");
        props.onSubmit(payload);
      }
      function update(key, value) {
        setDraft(function (prev) {
          var next = Object.assign({}, prev);
          next[key] = value;
          return next;
        });
      }
      return h("div", { className: "ocFormStack" },
        err ? h("div", { className: "ocErr" }, err) : null,
        props.fields.map(function (field) {
          return h("div", { key: field.key }, fieldNode(field, draft[field.key], function (value) { update(field.key, value); }));
        }),
        h("div", { className: "ocStickyActions" },
          h(Btn, { kind: "primary", disabled: props.busy, onClick: submit }, props.submitLabel || "保存"),
          props.onCancel ? h(Btn, { disabled: props.busy, onClick: props.onCancel }, "取消") : null));
    }

    function DeleteBtn(props) {
      var confirmS = react.useState(false);
      var confirm = confirmS[0], setConfirm = confirmS[1];
      if (!confirm) return h(Btn, { kind: "danger", disabled: props.disabled, onClick: function () { setConfirm(true); } }, props.label || "删除");
      return h("span", { className: "ocStickyActions" },
        h(Btn, { kind: "danger", disabled: props.disabled, onClick: function () { setConfirm(false); props.onConfirm(); } }, "确认删除"),
        h(Btn, { disabled: props.disabled, onClick: function () { setConfirm(false); } }, "取消"));
    }

    function CrudSection(props) {
      var scope = props.scope || "project";
      var ui = props.ui;
      var listS = useLoad(function () { return apiGet(adminListPath(scope, props.projectId, props.resource)); }, [scope, props.projectId, props.resource]);
      var rows = (listS[0].data && listS[0].data.items) || [];
      var modeS = react.useState("idle");
      var mode = modeS[0], setMode = modeS[1];
      var editS = react.useState(null);
      var editing = editS[0], setEditing = editS[1];
      var draftS = react.useState(emptyDraft(ui.fields));
      var draft = draftS[0], setDraft = draftS[1];
      var busyS = react.useState(false);
      var busy = busyS[0], setBusy = busyS[1];
      var formErrS = react.useState("");
      var formErr = formErrS[0], setFormErr = formErrS[1];
      react.useEffect(function () {
        setMode("idle"); setEditing(null); setDraft(emptyDraft(ui.fields)); setFormErr("");
      }, [props.projectId, props.resource]);
      function startCreate() { setMode("create"); setEditing(null); setDraft(emptyDraft(ui.fields)); setFormErr(""); }
      function startEdit(row) { setMode("edit"); setEditing(row); setDraft(formDraft(ui.fields, row)); setFormErr(""); }
      function reset() { setMode("idle"); setEditing(null); setDraft(emptyDraft(ui.fields)); setFormErr(""); }
      function save() {
        var payload;
        try { payload = payloadFromDraft(ui.fields, draft); }
        catch (e) { setFormErr(String((e && e.message) || e)); return; }
        setBusy(true); setFormErr("");
        var promise = mode === "edit" && editing
          ? adminUpdate(scope, props.projectId, props.resource, editing.id, payload)
          : adminCreate(scope, props.projectId, props.resource, payload);
        promise.then(function () {
          props.flash((mode === "edit" ? "已更新 " : "已创建 ") + ui.label, true);
          reset(); listS[1](); if (props.onChanged) props.onChanged();
        }).catch(function (e) {
          setFormErr(String((e && e.message) || e));
        }).then(function () { setBusy(false); });
      }
      function remove(row) {
        setBusy(true);
        adminRemove(scope, props.projectId, props.resource, row.id)
          .then(function () { props.flash("已删除 " + ui.label, true); if (editing && editing.id === row.id) reset(); listS[1](); if (props.onChanged) props.onChanged(); })
          .catch(function (e) { props.flash(String((e && e.message) || e), false); })
          .then(function () { setBusy(false); });
      }
      var columns = (ui.table || ui.fields.map(function (f) { return f.key; })).map(function (key) {
        var field = fieldOf(ui.fields, key);
        return { key: key, label: field.label, render: function (row) { return field.render ? field.render(row) : cellNode(field, row); } };
      });
      columns.push({ key: "__ops", label: "操作", render: function (row) {
        return h("div", { className: "ocStickyActions" },
          h(Btn, { disabled: busy, onClick: function () { startEdit(row); } }, "编辑"),
          h(DeleteBtn, { disabled: busy, onConfirm: function () { remove(row); } }));
      } });
      var side = mode === "idle"
        ? h("div", { className: "ocSection" },
            h("div", { className: "ocH" }, ui.label + "操作"),
            h("div", { className: "ocHint" }, ui.hint || "选择左侧记录编辑，或新建一条。"),
            h("div", { className: "ocStickyActions" }, h(Btn, { kind: "primary", onClick: startCreate }, "新建" + ui.label)))
        : h("div", { className: "ocSection" },
            h("div", { className: "ocH" }, (mode === "edit" ? "编辑" : "新建") + ui.label, editing ? h("span", { className: "ocCount" }, "#" + editing.id) : null),
            formErr ? h("div", { className: "ocErr" }, formErr) : null,
            h("div", { className: "ocFormStack" }, ui.fields.map(function (field) {
              return h("div", { key: field.key }, fieldNode(field, draft[field.key], function (value) {
                setDraft(function (prev) { var next = Object.assign({}, prev); next[field.key] = value; return next; });
              }));
            })),
            h("div", { className: "ocStickyActions" },
              h(Btn, { kind: "primary", disabled: busy, onClick: save }, "保存"),
              h(Btn, { disabled: busy, onClick: reset }, "取消"),
              mode === "edit" ? h(DeleteBtn, { disabled: busy, onConfirm: function () { remove(editing); } }) : null));
      return h("div", { className: "ocSection" },
        h("div", { className: "ocH" }, ui.label, h("span", { className: "ocCount", style: { marginLeft: "8px" } }, String(rows.length)),
          h("span", { className: "ocMuted", style: { marginLeft: "auto" } }, ui.hint || "")),
        h(ErrLine, { error: listS[0].error, onRetry: listS[1] }),
        h("div", { className: "ocSplit" },
          h("div", { className: "ocSplitMain" },
            h(Table, { columns: columns, rows: rows, loading: listS[0].loading, empty: ui.empty || "暂无" + ui.label, emptyHint: ui.emptyHint, emptyIcon: "layers" })),
          h("div", { className: "ocSplitSide" }, side)));
    }

    var PROJECT_FORM_FIELDS = [
      { key: "name", label: "项目名称", type: "text", required: true },
      { key: "projectType", label: "项目类型", type: "text", placeholder: "software" },
      { key: "stage", label: "阶段", type: "text", required: true, default: "initiation" },
      { key: "progress", label: "进度 %", type: "int", min: 0, max: 100, default: 0 },
      { key: "startDate", label: "计划开始", type: "date" },
      { key: "targetEndDate", label: "计划结束", type: "date" },
      { key: "actualStartDate", label: "实际开始", type: "date" },
      { key: "actualEndDate", label: "实际结束", type: "date" },
      { key: "timezone", label: "时区", type: "text", default: "Asia/Shanghai" },
      { key: "costActual", label: "实际成本", type: "number" },
      { key: "softwareProfile", label: "软件研发档案（JSON）", type: "json" },
      { key: "techStack", label: "技术栈（JSON）", type: "json" },
      { key: "workCalendar", label: "工作日历（JSON）", type: "json" },
      { key: "blockers", label: "阻塞项（JSON）", type: "json" },
    ];

    function ProjectForm(props) {
      var busyS = react.useState(false);
      var busy = busyS[0], setBusy = busyS[1];
      function submit(payload) {
        setBusy(true);
        var promise = props.project ? apiPut("/admin/projects/" + props.project.id, payload) : apiPost("/admin/projects", payload);
        promise.then(function () {
          props.flash(props.project ? "项目已更新" : "项目已创建", true);
          props.onDone();
        }).catch(function (e) {
          props.flash(String((e && e.message) || e), false);
        }).then(function () { setBusy(false); });
      }
      return h("div", { className: "ocSection" },
        h("div", { className: "ocH" }, props.project ? "编辑项目" : "新建项目"),
        h(EntityForm, { fields: PROJECT_FORM_FIELDS, initial: props.project || {}, formKey: props.project ? props.project.id : "new-project", busy: busy, submitLabel: props.project ? "保存" : "创建", onCancel: props.onCancel, onSubmit: submit }));
    }

    var PROJECT_UI = {
      milestones: {
        label: "里程碑", hint: "项目起点、关键节点与目标日期。", table: ["name", "targetDate", "status", "owner"],
        fields: [
          { key: "name", label: "名称", type: "text", required: true },
          { key: "stage", label: "阶段", type: "text" },
          { key: "targetDate", label: "目标日期", type: "date", required: true },
          { key: "actualDate", label: "实际日期", type: "date" },
          { key: "status", label: "状态", type: "enum", enum: ["planned", "in_progress", "achieved", "delayed", "cancelled"], default: "planned" },
          { key: "owner", label: "负责人", type: "text" },
          { key: "dependencies", label: "依赖（JSON）", type: "json" },
          { key: "evidence", label: "证据/说明", type: "textarea" },
        ],
      },
      repositories: {
        label: "版本库", hint: "只登记元数据；凭据只接受 env:/secret:/vault:/ssh-agent: 引用。", table: ["name", "kind", "url", "syncStatus"],
        fields: [
          { key: "name", label: "名称", type: "text", required: true },
          { key: "kind", label: "类型", type: "enum", enum: ["git", "svn"], required: true, default: "git" },
          { key: "url", label: "仓库地址", type: "text", required: true, placeholder: "git@host:group/repo.git" },
          { key: "defaultRef", label: "默认分支", type: "text", default: "main" },
          { key: "authRef", label: "凭据引用", type: "authRef", placeholder: "env:GIT_TOKEN" },
          { key: "syncMode", label: "同步方式", type: "enum", enum: ["manual", "schedule", "webhook"], default: "manual" },
          { key: "syncStatus", label: "同步状态", type: "enum", enum: ["pending", "synced", "failed", "disabled"], default: "pending" },
        ],
      },
      artifacts: {
        label: "制品库", hint: "Maven/Docker 等制品仓库登记；凭据只存引用。", table: ["name", "kind", "url", "status"],
        fields: [
          { key: "name", label: "名称", type: "text", required: true },
          { key: "kind", label: "类型", type: "enum", enum: ["maven", "docker", "npm", "other"], required: true, default: "docker" },
          { key: "url", label: "仓库地址", type: "text", required: true },
          { key: "namespace", label: "命名空间", type: "text" },
          { key: "authRef", label: "凭据引用", type: "authRef", placeholder: "secret:HARBOR_TOKEN" },
          { key: "retentionPolicy", label: "保留策略（JSON）", type: "json" },
          { key: "status", label: "状态", type: "enum", enum: ["active", "disabled"], default: "active" },
        ],
      },
      environments: {
        label: "部署环境", hint: "SSH 环境登记；生产环境必须使用 manual 审批。", table: ["envType", "name", "host", "status"],
        fields: [
          { key: "envType", label: "环境类型", type: "enum", enum: ["dev", "test", "staging", "prod"], required: true, default: "dev" },
          { key: "name", label: "名称", type: "text", required: true },
          { key: "host", label: "主机", type: "text", required: true },
          { key: "port", label: "端口", type: "int", min: 1, max: 65535, default: 22 },
          { key: "sshUser", label: "SSH 用户", type: "text", required: true },
          { key: "authRef", label: "凭据引用", type: "authRef", placeholder: "ssh-agent:deploy" },
          { key: "jumpHostRef", label: "跳板机引用", type: "text" },
          { key: "isolationLevel", label: "隔离级别", type: "enum", enum: ["shared", "dedicated"], default: "shared" },
          { key: "approvalPolicy", label: "审批策略", type: "enum", enum: ["auto", "manual"], default: "manual" },
          { key: "status", label: "状态", type: "enum", enum: ["active", "disabled"], default: "active" },
        ],
      },
      "test-plans": {
        label: "测试计划", hint: "进入/退出标准显式登记。", table: ["version", "status", "owner", "startDate"],
        fields: [
          { key: "version", label: "版本", type: "text", required: true },
          { key: "scope", label: "范围", type: "textarea" },
          { key: "testTypes", label: "测试类型（JSON）", type: "json" },
          { key: "entryCriteria", label: "进入标准", type: "textarea" },
          { key: "exitCriteria", label: "退出标准", type: "textarea" },
          { key: "environmentId", label: "环境 ID", type: "int" },
          { key: "owner", label: "负责人", type: "text" },
          { key: "startDate", label: "开始日期", type: "date" },
          { key: "endDate", label: "结束日期", type: "date" },
          { key: "status", label: "状态", type: "enum", enum: ["draft", "active", "closed", "cancelled"], default: "draft" },
        ],
      },
      "test-cases": {
        label: "测试用例", hint: "用例编号、步骤与优先级；未执行/阻塞不得计为通过。", table: ["caseCode", "title", "priority", "status"],
        fields: [
          { key: "caseCode", label: "用例编号", type: "text", required: true, placeholder: "TC-LOGIN-001" },
          { key: "title", label: "标题", type: "text", required: true },
          { key: "preconditions", label: "前置条件", type: "textarea" },
          { key: "steps", label: "步骤（JSON）", type: "json" },
          { key: "expected", label: "预期结果", type: "textarea" },
          { key: "priority", label: "优先级", type: "enum", enum: ["P0", "P1", "P2", "P3"], default: "P2" },
          { key: "kind", label: "类型", type: "enum", enum: ["manual", "auto"], default: "manual" },
          { key: "requirementRef", label: "需求引用", type: "text" },
          { key: "version", label: "版本", type: "text", default: "1" },
          { key: "status", label: "状态", type: "enum", enum: ["draft", "approved", "deprecated"], default: "draft" },
        ],
      },
      "test-suites": {
        label: "测试套件", hint: "把用例组织为可执行套件。", table: ["name", "status", "environmentId"],
        fields: [
          { key: "name", label: "套件名称", type: "text", required: true },
          { key: "caseIds", label: "用例 ID（JSON 数组）", type: "json" },
          { key: "environmentId", label: "环境 ID", type: "int" },
          { key: "status", label: "状态", type: "enum", enum: ["active", "disabled"], default: "active" },
        ],
      },
      defects: {
        label: "缺陷", hint: "S1–S4 分级；解决后记录回归结果。", table: ["severity", "title", "status", "owner"],
        fields: [
          { key: "severity", label: "严重级别", type: "enum", enum: ["S1", "S2", "S3", "S4"], required: true, default: "S3" },
          { key: "title", label: "标题", type: "text", required: true },
          { key: "reproSteps", label: "复现步骤", type: "textarea" },
          { key: "affectedVersion", label: "影响版本", type: "text" },
          { key: "testCaseId", label: "关联用例 ID", type: "int" },
          { key: "requirementRef", label: "需求引用", type: "text" },
          { key: "owner", label: "负责人", type: "text" },
          { key: "status", label: "状态", type: "enum", enum: ["open", "in_progress", "resolved", "closed", "reopened"], default: "open" },
          { key: "regressionResult", label: "回归结果", type: "text" },
        ],
      },
      "work-logs": {
        label: "工时", hint: "按人按日记录工时（0–24 小时）。", table: ["workDate", "worker", "hours", "source"],
        fields: [
          { key: "worker", label: "成员", type: "text", required: true },
          { key: "workDate", label: "工作日期", type: "date", required: true },
          { key: "hours", label: "工时", type: "number", required: true, min: 0.01, max: 24 },
          { key: "source", label: "来源", type: "enum", enum: ["manual", "import", "agent"], default: "manual" },
          { key: "note", label: "备注", type: "textarea" },
          { key: "taskId", label: "任务 ID", type: "int" },
        ],
      },
    };

    var PROJECT_VIEWS = [
      { id: "milestones", label: "里程碑" },
      { id: "repositories", label: "版本库" },
      { id: "artifacts", label: "制品库" },
      { id: "environments", label: "环境" },
      { id: "releases", label: "发布" },
      { id: "test-plans", label: "测试计划" },
      { id: "test-cases", label: "测试用例" },
      { id: "test-suites", label: "测试套件" },
      { id: "test-runs", label: "测试批次" },
      { id: "defects", label: "缺陷" },
      { id: "work-logs", label: "工时" },
    ];

    function ReleasesSection(props) {
      var relS = useLoad(function () { return apiGet("/admin/projects/" + props.projectId + "/releases"); }, [props.projectId]);
      var envS = useLoad(function () { return apiGet("/admin/projects/" + props.projectId + "/environments"); }, [props.projectId]);
      var releases = (relS[0].data && relS[0].data.items) || [];
      var environments = (envS[0].data && envS[0].data.items) || [];
      var approverS = react.useState("boss");
      var approver = approverS[0], setApprover = approverS[1];
      var busyS = react.useState(false);
      var busy = busyS[0], setBusy = busyS[1];
      var resetS = react.useState(0);
      var resetKey = resetS[0], setResetKey = resetS[1];
      var envMap = {};
      environments.forEach(function (env) { envMap[env.id] = env.name + " (" + env.envType + ")"; });
      function reload() { relS[1](); envS[1](); if (props.onChanged) props.onChanged(); }
      function act(promise, ok) {
        setBusy(true);
        promise.then(function () { props.flash(ok, true); reload(); })
          .catch(function (e) { props.flash(String((e && e.message) || e), false); })
          .then(function () { setBusy(false); });
      }
      function approve(row) { act(apiPost("/admin/releases/" + row.id + "/approve", { approver: approver }), "发布单已审批"); }
      function reject(row) { act(apiPost("/admin/releases/" + row.id + "/reject", { approver: approver }), "发布单已驳回"); }
      function remove(row) { act(apiDelete("/admin/releases/" + row.id), "发布单已删除"); }
      var fields = [
        { key: "version", label: "版本", type: "text", required: true },
        { key: "environmentId", label: "目标环境", type: "enum", required: true, options: environments.map(function (env) { return { value: String(env.id), label: env.name + " (" + env.envType + ")" }; }) },
        { key: "rollbackVersion", label: "回滚版本", type: "text", placeholder: "生产发布必填" },
        { key: "changeNote", label: "变更说明", type: "textarea" },
        { key: "requestedBy", label: "申请人", type: "text", required: true, default: "boss" },
        { key: "artifactRefs", label: "制品引用（JSON）", type: "json" },
        { key: "repoRefs", label: "版本库引用（JSON）", type: "json" },
      ];
      var columns = [
        { key: "version", label: "版本", render: function (r) { return h("b", null, r.version); } },
        { key: "environmentId", label: "环境", render: function (r) { return h("span", null, envMap[r.environmentId] || ("#" + r.environmentId)); } },
        { key: "status", label: "状态", render: function (r) { return h(Badge, { tone: toneOf(r.status) }, r.status); } },
        { key: "rollbackVersion", label: "回滚版本", render: function (r) { return h("span", { className: "ocMono" }, r.rollbackVersion || "-"); } },
        { key: "requestedBy", label: "申请人", render: function (r) { return h("span", null, r.requestedBy || "-"); } },
        { key: "approvedBy", label: "审批人", render: function (r) { return h("span", null, r.approvedBy || "-"); } },
        { key: "ops", label: "操作", render: function (r) {
            return h("div", { className: "ocStickyActions" },
              h(Btn, { disabled: busy || r.status !== "pending", onClick: function () { approve(r); } }, "通过"),
              h(Btn, { kind: "danger", disabled: busy || r.status !== "pending", onClick: function () { reject(r); } }, "驳回"),
              h(DeleteBtn, { disabled: busy || r.status !== "pending", onConfirm: function () { remove(r); } }));
          } },
      ];
      return h("div", { className: "ocSection" },
        h("div", { className: "ocH" }, "发布单", h("span", { className: "ocCount" }, String(releases.length))),
        h(ErrLine, { error: relS[0].error || envS[0].error, onRetry: reload }),
        h("div", { className: "ocSplit" },
          h("div", { className: "ocSplitMain" },
            h(Table, { columns: columns, rows: releases, loading: relS[0].loading, empty: "暂无发布单", emptyHint: "选择环境和版本创建发布单；生产发布必须填写回滚版本。", emptyIcon: "flow" })),
          h("div", { className: "ocSplitSide" },
            h("div", { className: "ocSection" },
              h("div", { className: "ocH" }, "新建发布单"),
              h("div", { className: "ocHint" }, "生产环境按策略进入人工审批；审批人：" + approver),
              h(Field, { label: "审批人", value: approver, onChange: setApprover }),
              h(EntityForm, { fields: fields, initial: {}, formKey: "release-" + resetKey + "-" + props.projectId, busy: busy, submitLabel: "提交发布单", onSubmit: function (payload) {
                act(apiPost("/admin/projects/" + props.projectId + "/releases", payload), "发布单已创建");
                setResetKey(function (v) { return v + 1; });
              } })))));
    }

    function TestRunsSection(props) {
      var runS = useLoad(function () { return apiGet("/admin/projects/" + props.projectId + "/test-runs"); }, [props.projectId]);
      var caseS = useLoad(function () { return apiGet("/admin/projects/" + props.projectId + "/test-cases"); }, [props.projectId]);
      var runs = (runS[0].data && runS[0].data.items) || [];
      var cases = (caseS[0].data && caseS[0].data.items) || [];
      var modeS = react.useState("create");
      var mode = modeS[0], setMode = modeS[1];
      var busyS = react.useState(false);
      var busy = busyS[0], setBusy = busyS[1];
      var resetS = react.useState(0);
      var resetKey = resetS[0], setResetKey = resetS[1];
      function reload() { runS[1](); caseS[1](); if (props.onChanged) props.onChanged(); }
      function act(promise, ok) {
        setBusy(true);
        promise.then(function () { props.flash(ok, true); reload(); setResetKey(function (v) { return v + 1; }); })
          .catch(function (e) { props.flash(String((e && e.message) || e), false); })
          .then(function () { setBusy(false); });
      }
      var createFields = [
        { key: "version", label: "版本", type: "text", required: true },
        { key: "executor", label: "执行人", type: "text", required: true, default: "boss" },
        { key: "executorType", label: "执行类型", type: "enum", enum: ["human", "agent", "ci"], default: "human" },
        { key: "planId", label: "测试计划 ID", type: "int" },
        { key: "suiteId", label: "测试套件 ID", type: "int" },
        { key: "environmentId", label: "环境 ID", type: "int" },
      ];
      var resultFields = [
        { key: "runId", label: "测试批次", type: "enum", required: true, options: runs.map(function (run) { return { value: String(run.id), label: "#" + run.id + " · " + run.version + " · " + run.status }; }) },
        { key: "caseId", label: "测试用例", type: "enum", required: true, options: cases.map(function (c) { return { value: String(c.id), label: c.caseCode + " · " + c.title }; }) },
        { key: "result", label: "结果", type: "enum", enum: ["passed", "failed", "blocked", "skipped"], required: true, default: "passed" },
        { key: "evidence", label: "证据", type: "textarea" },
        { key: "failureReason", label: "失败原因", type: "textarea" },
      ];
      var columns = [
        { key: "id", label: "#", render: function (r) { return h("span", { className: "ocMono" }, String(r.id)); } },
        { key: "version", label: "版本", render: function (r) { return h("b", null, r.version); } },
        { key: "executor", label: "执行人", render: function (r) { return h("span", null, r.executor); } },
        { key: "executorType", label: "类型", render: function (r) { return h(Badge, { tone: "mute" }, r.executorType); } },
        { key: "status", label: "状态", render: function (r) { return h(Badge, { tone: toneOf(r.status) }, r.status); } },
        { key: "startedAt", label: "开始", render: function (r) { return h("span", { className: "ocMono" }, fmtTime(r.startedAt)); } },
      ];
      var createForm = h(EntityForm, {
        fields: createFields, initial: {}, formKey: "run-create-" + resetKey + "-" + props.projectId, busy: busy, submitLabel: "创建批次",
        onSubmit: function (payload) { act(apiPost("/admin/projects/" + props.projectId + "/test-runs", payload), "测试批次已创建"); },
      });
      var resultForm = h(EntityForm, {
        fields: resultFields, initial: {}, formKey: "run-result-" + resetKey + "-" + props.projectId, busy: busy, submitLabel: "记录结果",
        onSubmit: function (payload) {
          var runId = payload.runId;
          delete payload.runId;
          act(apiPost("/admin/test-runs/" + runId + "/results", payload), "测试结果已记录");
        },
      });
      var sideForm = h("div", { className: "ocSection" },
        h("div", { className: "ocSeg", role: "group", "aria-label": "测试批次操作" },
          h("button", { type: "button", className: "ocSegItem" + (mode === "create" ? " on" : ""), "aria-pressed": mode === "create" ? "true" : "false", onClick: function () { setMode("create"); } }, "新建批次"),
          h("button", { type: "button", className: "ocSegItem" + (mode === "result" ? " on" : ""), "aria-pressed": mode === "result" ? "true" : "false", onClick: function () { setMode("result"); } }, "录入结果")),
        mode === "create" ? createForm : resultForm);
      return h("div", { className: "ocSection" },
        h("div", { className: "ocH" }, "测试批次", h("span", { className: "ocCount" }, String(runs.length))),
        h(ErrLine, { error: runS[0].error || caseS[0].error, onRetry: reload }),
        h("div", { className: "ocSplit" },
          h("div", { className: "ocSplitMain" },
            h(Table, { columns: columns, rows: runs, loading: runS[0].loading, empty: "暂无测试批次", emptyHint: "创建批次并逐用例记录结果；失败/阻塞不会计为通过。", emptyIcon: "check" })),
          h("div", { className: "ocSplitSide" }, sideForm)));
    }

    function ProjectsTab(props) {
      var projectsS = useLoad(function () { return apiGet("/admin/projects"); }, []);
      var projects = (projectsS[0].data && projectsS[0].data.items) || [];
      var selS = react.useState("");
      var selected = selS[0], setSelected = selS[1];
      var viewS = react.useState("milestones");
      var view = viewS[0], setView = viewS[1];
      var formS = react.useState(null);
      var form = formS[0], setForm = formS[1];
      react.useEffect(function () {
        if (!selected && projects.length) setSelected(String(projects[0].id));
      }, [projects.length, selected]);
      var project = null;
      for (var i = 0; i < projects.length; i += 1) if (String(projects[i].id) === String(selected)) project = projects[i];
      var summaryS = useLoad(function () { return selected ? apiGet("/admin/projects/" + selected + "/summary") : Promise.resolve(null); }, [selected]);
      var summary = summaryS[0].data || {};
      function reloadAll() { projectsS[1](); summaryS[1](); }
      function done() { setForm(null); projectsS[1](); summaryS[1](); }
      var body = null;
      if (project) {
        if (view === "releases") body = h(ReleasesSection, { key: "releases-" + selected, projectId: selected, flash: props.flash, onChanged: function () { summaryS[1](); } });
        else if (view === "test-runs") body = h(TestRunsSection, { key: "test-runs-" + selected, projectId: selected, flash: props.flash, onChanged: function () { summaryS[1](); } });
        else body = h(CrudSection, { key: selected + "-" + view, scope: "project", projectId: selected, resource: view, ui: PROJECT_UI[view], flash: props.flash, onChanged: function () { summaryS[1](); } });
      }
      return h(Fragment, null,
        h(PageHeader, { title: "项目管理", subtitle: projects.length + " 个项目 · 软件研发要素与质量闭环" },
          h(Select, { label: "当前项目", value: selected, options: projects.map(function (p) { return { value: String(p.id), label: p.name + " · " + p.stage }; }), onChange: setSelected }),
          h(Btn, { onClick: function () { setForm({ project: null }); } }, "新建"),
          project ? h(Btn, { onClick: function () { setForm({ project: project }); } }, "编辑项目") : null,
          h(Btn, { onClick: reloadAll }, h(Icon, { name: "refresh", size: 14 }), t("panel.refresh"))),
        h(ErrLine, { error: projectsS[0].error, onRetry: reloadAll }),
        form ? h(ProjectForm, { project: form.project, flash: props.flash, onDone: done, onCancel: function () { setForm(null); } }) : null,
        !projects.length && !projectsS[0].loading
          ? h(EmptyState, { title: "还没有项目", hint: "先新建项目，再管理里程碑、版本库、环境、发布、测试与缺陷。", icon: "layers", action: h(Btn, { kind: "primary", onClick: function () { setForm({ project: null }); } }, "新建项目") })
          : project ? h(Fragment, null,
              h("div", { className: "ocMeta" },
                h(Badge, { tone: toneOf(project.stage) }, project.stage || "未定阶段"),
                h("span", { className: "ocMuted" }, "进度"),
                h("div", { className: "ocProgressWrap" },
                  h("div", { className: "ocBar" }, h("i", { style: { width: (project.progress || 0) + "%" } })),
                  h("b", null, (project.progress || 0) + "%")),
                h("span", { className: "ocMuted" }, "计划 " + (project.startDate ? String(project.startDate).slice(0, 10) : "-") + " → " + (project.targetEndDate ? String(project.targetEndDate).slice(0, 10) : "-")),
                project.timezone ? h("span", { className: "ocMono" }, project.timezone) : null),
              summaryS[0].loading ? h("div", { className: "ocMetrics", role: "status", "aria-busy": "true", "aria-label": t("panel.loading") }, [0, 1, 2, 3, 4, 5].map(function (k) { return h("div", { className: "ocMetric", key: k }, h("span", { className: "ocSkel", style: { width: "60%", display: "block" } }), h("span", { className: "ocSkel", style: { width: "40%", height: 20, display: "block", marginTop: 8 } })); }))
                : h(KpiGrid, { items: [
                    { label: "里程碑", value: summary.milestonesTotal || 0, hint: "逾期 " + (summary.milestonesOverdue || 0) },
                    { label: "逾期里程碑", value: summary.milestonesOverdue || 0, tone: (summary.milestonesOverdue || 0) > 0 ? "bad" : "" },
                    { label: "待批发布", value: summary.releasesPending || 0, tone: (summary.releasesPending || 0) > 0 ? "warn" : "" },
                    { label: "测试通过率", value: summary.testPassRate || 0, unit: "%", tone: (summary.testPassRate || 0) >= 95 ? "ok" : (summary.testPassRate || 0) > 0 ? "warn" : "" },
                    { label: "未关闭缺陷", value: summary.defectsOpen || 0, tone: (summary.defectsOpen || 0) > 0 ? "bad" : "ok" },
                    { label: "版本库异常", value: summary.repositoriesFailed || 0, tone: (summary.repositoriesFailed || 0) > 0 ? "bad" : "ok" },
                    { label: "累计工时", value: summary.workHours || 0, unit: "h" },
                  ] }),
              h("div", { className: "ocSeg", role: "group", "aria-label": "项目管理视图" },
                PROJECT_VIEWS.map(function (item) {
                  var on = item.id === view;
                  return h("button", { key: item.id, type: "button", className: "ocSegItem" + (on ? " on" : ""), "aria-pressed": on ? "true" : "false", onClick: function () { setView(item.id); } }, item.label);
                })),
              body)
          : h(SkeletonTable, { columns: [{ key: "a" }, { key: "b" }, { key: "c" }], rows: 5 }));
    }

    // ================= 情报管理 =================
    var INTEL_UI = {
      scopes: {
        label: "情报空间", hint: "每个项目一个情报空间；日报时间、回看窗口、条目上限与推送渠道。", table: ["name", "briefTime", "lookbackHours", "status"],
        fields: [
          { key: "name", label: "空间名称", type: "text", required: true },
          { key: "timezone", label: "时区", type: "text", default: "Asia/Shanghai" },
          { key: "briefTime", label: "日报时间", type: "text", default: "08:00", placeholder: "08:00" },
          { key: "lookbackHours", label: "回看小时", type: "int", min: 1, max: 720, default: 24 },
          { key: "maxItems", label: "日报条目上限", type: "int", min: 1, max: 200, default: 20 },
          { key: "pushChannels", label: "推送渠道（JSON）", type: "json" },
          { key: "recipients", label: "接收人（JSON）", type: "json" },
          { key: "quietHours", label: "静默时段（JSON）", type: "json" },
          { key: "template", label: "模板", type: "text" },
          { key: "status", label: "状态", type: "enum", enum: ["active", "disabled"], default: "active" },
          { key: "configVersion", label: "配置版本", type: "text", default: "1" },
        ],
      },
      sources: {
        label: "数据源", hint: "全局数据源；通过「来源绑定」挂到项目。凭据只接受引用。", table: ["name", "sourceType", "credibility", "status"],
        fields: [
          { key: "name", label: "名称", type: "text", required: true },
          { key: "sourceType", label: "类型", type: "enum", enum: ["rss", "api", "web", "search", "mcp", "manual"], required: true, default: "rss" },
          { key: "url", label: "地址", type: "text", placeholder: "https://..." },
          { key: "authRef", label: "凭据引用", type: "authRef", placeholder: "secret:SOURCE_TOKEN" },
          { key: "credibility", label: "可信度", type: "number", min: 0, max: 1, default: 0.5 },
          { key: "copyrightStatus", label: "版权状态", type: "enum", enum: ["licensed", "public", "unknown", "restricted"], default: "unknown" },
          { key: "licenseNote", label: "版权说明", type: "textarea" },
          { key: "collectIntervalMinutes", label: "采集间隔（分钟）", type: "int", min: 5, max: 10080, default: 60 },
          { key: "rateLimitPerHour", label: "每小时限流", type: "int", min: 1, max: 10000, default: 60 },
          { key: "timeoutMs", label: "超时（毫秒）", type: "int", min: 1000, max: 300000, default: 15000 },
          { key: "enabled", label: "启用", type: "bool", default: true },
          { key: "status", label: "状态", type: "enum", enum: ["active", "disabled", "blocked"], default: "active" },
        ],
      },
      topics: {
        label: "关注主题", hint: "关键词/标签决定情报命中与评分；优先级越高权重越大。", table: ["keyword", "matchType", "priority", "enabled"],
        fields: [
          { key: "keyword", label: "关键词", type: "text", required: true },
          { key: "matchType", label: "匹配方式", type: "enum", enum: ["exact", "phrase", "regex", "boolean"], default: "phrase" },
          { key: "synonyms", label: "同义词（JSON 数组）", type: "json" },
          { key: "excludeTerms", label: "排除词（JSON 数组）", type: "json" },
          { key: "tags", label: "标签（JSON 数组）", type: "json" },
          { key: "priority", label: "优先级", type: "int", min: 1, max: 1000, default: 100 },
          { key: "enabled", label: "启用", type: "bool", default: true },
          { key: "version", label: "版本", type: "int", default: 1 },
        ],
      },
      tags: {
        label: "标签", hint: "用于情报归类与日报分区。", table: ["name", "category", "status"],
        fields: [
          { key: "name", label: "标签名", type: "text", required: true },
          { key: "category", label: "分类", type: "text" },
          { key: "parentId", label: "父标签 ID", type: "int" },
          { key: "color", label: "颜色", type: "text", placeholder: "#3b82f6" },
          { key: "description", label: "说明", type: "textarea" },
          { key: "status", label: "状态", type: "enum", enum: ["active", "disabled"], default: "active" },
        ],
      },
    };

    function bindingsUi(sources) {
      return {
        label: "来源绑定", hint: "把全局数据源绑定到当前项目；未绑定的来源不参与采集。", table: ["sourceId", "enabled", "priority"],
        fields: [
          { key: "sourceId", label: "数据源", type: "enum", required: true, options: sources.map(function (source) { return { value: String(source.id), label: source.name + " · " + source.sourceType }; }), render: function (row) {
              var match = null;
              for (var i = 0; i < sources.length; i += 1) if (String(sources[i].id) === String(row.sourceId)) match = sources[i];
              return h("span", null, match ? match.name + " · " + match.sourceType : "#" + row.sourceId);
            } },
          { key: "enabled", label: "启用", type: "bool", default: true },
          { key: "priority", label: "优先级", type: "int", min: 1, max: 1000, default: 100 },
          { key: "tags", label: "标签（JSON）", type: "json" },
        ],
      };
    }

    var INTEL_VIEWS = [
      { id: "overview", label: "概览" },
      { id: "scopes", label: "情报空间" },
      { id: "sources", label: "数据源" },
      { id: "topics", label: "关注主题" },
      { id: "tags", label: "标签" },
      { id: "items", label: "情报条目" },
      { id: "briefs", label: "日报" },
      { id: "runs", label: "流水线" },
    ];

    function IntelItemsSection(props) {
      var statusS = react.useState("");
      var status = statusS[0], setStatus = statusS[1];
      var listS = useLoad(function () {
        return apiGet("/admin/intel/items" + qs({ projectId: props.projectId, status: status, limit: 200 }));
      }, [props.projectId, status]);
      var items = (listS[0].data && listS[0].data.items) || [];
      var detailS = react.useState(null);
      var detail = detailS[0], setDetail = detailS[1];
      var busyS = react.useState(false);
      var busy = busyS[0], setBusy = busyS[1];
      function setItemStatus(item, next) {
        setBusy(true);
        apiPut("/admin/intel/items/" + item.id, { status: next })
          .then(function () { props.flash("条目状态已更新为 " + next, true); listS[1](); if (props.onChanged) props.onChanged(); setDetail(function (prev) { return prev && prev.id === item.id ? Object.assign({}, prev, { status: next }) : prev; }); })
          .catch(function (e) { props.flash(String((e && e.message) || e), false); })
          .then(function () { setBusy(false); });
      }
      var columns = [
        { key: "title", label: "标题", render: function (r) { return h("div", { className: "ocList" }, h("b", null, short(r.title, 64)), r.summary ? h("span", { className: "ocMuted" }, short(r.summary, 90)) : null); } },
        { key: "sourceName", label: "来源", render: function (r) { return h("span", null, r.sourceName || "-"); } },
        { key: "relevanceScore", label: "评分", render: function (r) { return h("span", { className: "ocMono" }, r.relevanceScore === null || r.relevanceScore === undefined ? "-" : String(r.relevanceScore)); } },
        { key: "riskLevel", label: "风险", render: function (r) { return r.riskLevel ? h(Badge, { tone: toneOf(r.riskLevel) }, r.riskLevel) : h("span", { className: "ocMuted" }, "-"); } },
        { key: "status", label: "状态", render: function (r) { return h(Badge, { tone: toneOf(r.status) }, r.status); } },
        { key: "publishedAt", label: "发布", render: function (r) { return h("span", { className: "ocMono" }, fmtTime(r.publishedAt)); } },
        { key: "ops", label: "操作", render: function (r) { return h(Btn, { onClick: function () { setDetail(r); } }, "详情"); } },
      ];
      var side = detail
        ? h("div", { className: "ocSection" },
            h("div", { className: "ocH" }, "情报条目", h("span", { className: "ocCount" }, "#" + detail.id)),
            h("div", { className: "ocFormStack" },
              h("div", null, h("b", null, detail.title)),
              h("div", { className: "ocRow" },
                h(Badge, { tone: toneOf(detail.status) }, detail.status),
                detail.sourceName ? h("span", { className: "ocMuted" }, detail.sourceName) : null,
                detail.relevanceScore !== null && detail.relevanceScore !== undefined ? h("span", { className: "ocMono" }, "score " + detail.relevanceScore) : null),
              detail.summary ? h("div", { className: "ocMuted", style: { whiteSpace: "pre-wrap" } }, detail.summary) : null,
              detail.tags && detail.tags.length ? h("div", null, detail.tags.map(function (tag) { return h("span", { className: "ocTag", key: tag }, tag); })) : null,
              detail.url ? h("a", { href: detail.url, target: "_blank", rel: "noopener noreferrer" }, "打开原文") : null,
              h("div", { className: "ocStickyActions" },
                h(Btn, { disabled: busy, onClick: function () { setItemStatus(detail, "analyzed"); } }, "标记已分析"),
                h(Btn, { disabled: busy, onClick: function () { setItemStatus(detail, "filtered"); } }, "过滤"),
                h(Btn, { disabled: busy, onClick: function () { setItemStatus(detail, "archived"); } }, "归档"))))
        : h("div", { className: "ocSection" },
            h("div", { className: "ocH" }, "条目详情"),
            h("div", { className: "ocHint" }, "选择左侧条目查看摘要、评分、来源与处理动作。"));
      return h("div", { className: "ocSection" },
        h("div", { className: "ocH" }, "情报条目", h("span", { className: "ocCount" }, String(items.length))),
        h("div", { className: "ocSeg", role: "group", "aria-label": "情报条目状态过滤" },
          [{ id: "", label: "全部" }, { id: "collected", label: "新采集" }, { id: "analyzed", label: "已分析" }, { id: "filtered", label: "已过滤" }, { id: "briefed", label: "已入日报" }, { id: "archived", label: "已归档" }].map(function (item) {
            var on = item.id === status;
            return h("button", { key: item.id || "all", type: "button", className: "ocSegItem" + (on ? " on" : ""), "aria-pressed": on ? "true" : "false", onClick: function () { setStatus(item.id); } }, item.label);
          })),
        h(ErrLine, { error: listS[0].error, onRetry: listS[1] }),
        h("div", { className: "ocSplit" },
          h("div", { className: "ocSplitMain" },
            h(Table, { columns: columns, rows: items, loading: listS[0].loading, empty: "暂无情报条目", emptyHint: "配置数据源与关注主题后，采集/分析流水线会在这里沉淀条目。", emptyIcon: "target" })),
          h("div", { className: "ocSplitSide" }, side)));
    }

    function IntelBriefsSection(props) {
      var listS = useLoad(function () { return apiGet("/admin/intel/briefs" + qs({ projectId: props.projectId })); }, [props.projectId]);
      var briefs = (listS[0].data && listS[0].data.items) || [];
      var selS = react.useState("");
      var selected = selS[0], setSelected = selS[1];
      var detailS = useLoad(function () { return selected ? apiGet("/admin/intel/briefs/" + selected) : Promise.resolve(null); }, [selected]);
      var detail = detailS[0].data;
      var columns = [
        { key: "briefDate", label: "日期", render: function (r) { return h("span", { className: "ocMono" }, String(r.briefDate).slice(0, 10)); } },
        { key: "title", label: "标题", render: function (r) { return h("b", null, short(r.title, 60)); } },
        { key: "status", label: "状态", render: function (r) { return h(Badge, { tone: toneOf(r.status) }, r.status); } },
        { key: "itemCount", label: "条目", render: function (r) { return h("span", { className: "ocMono" }, String(r.itemCount)); } },
        { key: "sourceCount", label: "来源", render: function (r) { return h("span", { className: "ocMono" }, String(r.sourceCount)); } },
        { key: "generatedAt", label: "生成", render: function (r) { return h("span", { className: "ocMono" }, fmtTime(r.generatedAt)); } },
        { key: "ops", label: "操作", render: function (r) { return h(Btn, { onClick: function () { setSelected(String(r.id)); } }, "查看"); } },
      ];
      var sectionLabels = { headline: "头条", policy: "政策", competitor: "竞品", lead: "线索", risk: "风险", sentiment: "舆情", other: "其他" };
      var sectionNodes = [];
      if (detail && detail.sections) {
        Object.keys(detail.sections).forEach(function (key) {
          var entries = detail.sections[key];
          if (!entries || !entries.length) return;
          sectionNodes.push(h("div", { key: key },
            h("h4", null, sectionLabels[key] || key),
            h("ul", { className: "ocDetailList" }, entries.map(function (entry, index) {
              return h("li", { className: "ocDetailItem", key: entry.id || index },
                h("b", null, entry.title),
                entry.summary ? h("span", { className: "ocMuted" }, short(entry.summary, 180)) : null,
                h("div", { className: "ocRow" },
                  entry.sourceName ? h("span", { className: "ocMuted" }, entry.sourceName) : null,
                  entry.score !== null && entry.score !== undefined ? h("span", { className: "ocMono" }, "score " + entry.score) : null,
                  entry.riskLevel ? h(Badge, { tone: toneOf(entry.riskLevel) }, entry.riskLevel) : null,
                  entry.url ? h("a", { href: entry.url, target: "_blank", rel: "noopener noreferrer" }, "原文") : null));
            }))));
        });
      }
      var side = detail
        ? h("div", { className: "ocSection" },
            h("div", { className: "ocH" }, "日报详情", h("span", { className: "ocCount" }, "v" + detail.version)),
            h("div", { className: "ocMeta" }, h(Badge, { tone: toneOf(detail.status) }, detail.status), h("span", { className: "ocMuted" }, String(detail.briefDate).slice(0, 10)), h("span", { className: "ocMono" }, "条目 " + detail.itemCount + " · 来源 " + detail.sourceCount)),
            h("div", { className: "ocDetail" },
              h("h4", null, "覆盖度与免责声明"),
              h("pre", { className: "ocJson" }, JSON.stringify(detail.coverage || {}, null, 2)),
              sectionNodes.length ? h("div", { className: "ocDetail" }, sectionNodes) : h("div", { className: "ocEmpty" }, "日报暂无分区内容")) )
        : h("div", { className: "ocSection" },
            h("div", { className: "ocH" }, "日报详情"),
            h("div", { className: "ocHint" }, "选择左侧日报查看覆盖度、分区与条目。"));
      return h("div", { className: "ocSection" },
        h("div", { className: "ocH" }, "情报日报", h("span", { className: "ocCount" }, String(briefs.length))),
        h(ErrLine, { error: listS[0].error || detailS[0].error, onRetry: function () { listS[1](); if (selected) detailS[1](); } }),
        h("div", { className: "ocSplit" },
          h("div", { className: "ocSplitMain" },
            h(Table, { columns: columns, rows: briefs, loading: listS[0].loading, empty: "暂无情报日报", emptyHint: "在「流水线」触发 brief 阶段生成日报。", emptyIcon: "book" })),
          h("div", { className: "ocSplitSide" }, side)));
    }

    function IntelRunsSection(props) {
      var runS = useLoad(function () { return apiGet("/admin/intel/runs" + qs({ projectId: props.projectId })); }, [props.projectId]);
      var data = runS[0].data || { pipeline: [], collect: [], push: [] };
      var busyS = react.useState("");
      var busy = busyS[0], setBusy = busyS[1];
      var labels = { analyze: "分析", aggregate: "汇总", brief: "生成日报", push: "推送" };
      function trigger(stage) {
        setBusy(stage);
        apiPost("/admin/intel/run/" + stage, { projectId: props.projectId })
          .then(function () { props.flash("已触发" + labels[stage], true); runS[1](); if (props.onChanged) props.onChanged(); })
          .catch(function (e) { props.flash(String((e && e.message) || e), false); })
          .then(function () { setBusy(""); });
      }
      var pipelineCols = [
        { key: "stage", label: "阶段", render: function (r) { return h(Badge, { tone: "mute" }, r.stage); } },
        { key: "status", label: "状态", render: function (r) { return h(Badge, { tone: toneOf(r.status) }, r.status); } },
        { key: "pipelineDate", label: "日期", render: function (r) { return h("span", { className: "ocMono" }, String(r.pipelineDate || "").slice(0, 10)); } },
        { key: "startedAt", label: "开始", render: function (r) { return h("span", { className: "ocMono" }, fmtTime(r.startedAt)); } },
        { key: "counters", label: "计数", render: function (r) { return h("span", { className: "ocEllip", title: fmtVal(r.counters) }, short(fmtVal(r.counters), 50)); } },
        { key: "error", label: "错误", render: function (r) { return r.error ? h("span", { className: "ocDangerText" }, short(r.error, 50)) : h("span", { className: "ocMuted" }, "-"); } },
      ];
      var collectCols = [
        { key: "sourceId", label: "来源", render: function (r) { return h("span", { className: "ocMono" }, r.sourceId === null || r.sourceId === undefined ? "-" : String(r.sourceId)); } },
        { key: "status", label: "状态", render: function (r) { return h(Badge, { tone: toneOf(r.status) }, r.status); } },
        { key: "fetched", label: "抓取", render: function (r) { return h("span", { className: "ocMono" }, String(r.fetched || 0)); } },
        { key: "inserted", label: "入库", render: function (r) { return h("span", { className: "ocMono" }, String(r.inserted || 0)); } },
        { key: "duplicates", label: "去重", render: function (r) { return h("span", { className: "ocMono" }, String(r.duplicates || 0)); } },
        { key: "error", label: "错误", render: function (r) { return r.error ? h("span", { className: "ocDangerText" }, short(r.error, 50)) : h("span", { className: "ocMuted" }, "-"); } },
      ];
      var pushCols = [
        { key: "briefId", label: "日报", render: function (r) { return h("span", { className: "ocMono" }, "#" + r.briefId); } },
        { key: "channel", label: "渠道", render: function (r) { return h("span", { className: "ocMono" }, r.channel); } },
        { key: "target", label: "目标", render: function (r) { return h("span", { className: "ocEllip", title: r.target }, short(r.target, 36)); } },
        { key: "status", label: "状态", render: function (r) { return h(Badge, { tone: toneOf(r.status) }, r.status); } },
        { key: "sentAt", label: "发送", render: function (r) { return h("span", { className: "ocMono" }, fmtTime(r.sentAt)); } },
        { key: "error", label: "错误", render: function (r) { return r.error ? h("span", { className: "ocDangerText" }, short(r.error, 50)) : h("span", { className: "ocMuted" }, "-"); } },
      ];
      return h(Fragment, null,
        h("div", { className: "ocSection" },
          h("div", { className: "ocH" }, "流水线触发", h("span", { className: "ocMuted", style: { marginLeft: "auto" } }, "手动触发会强制重跑当前阶段")),
          h("div", { className: "ocStickyActions" }, Object.keys(labels).map(function (stage) {
            return h(Btn, { key: stage, kind: stage === "push" ? "primary" : "", disabled: !!busy, onClick: function () { trigger(stage); } }, labels[stage]);
          }))),
        h(ErrLine, { error: runS[0].error, onRetry: runS[1] }),
        h("div", { className: "ocSection" },
          h("div", { className: "ocH" }, "流水线运行", h("span", { className: "ocCount" }, String(data.pipeline.length))),
          h(Table, { columns: pipelineCols, rows: data.pipeline, loading: runS[0].loading, empty: "暂无流水线运行", emptyIcon: "sync" })),
        h("div", { className: "ocSection" },
          h("div", { className: "ocH" }, "采集运行", h("span", { className: "ocCount" }, String(data.collect.length))),
          h(Table, { columns: collectCols, rows: data.collect, loading: runS[0].loading, empty: "暂无采集运行", emptyIcon: "sync" })),
        h("div", { className: "ocSection" },
          h("div", { className: "ocH" }, "推送记录", h("span", { className: "ocCount" }, String(data.push.length))),
          h(Table, { columns: pushCols, rows: data.push, loading: runS[0].loading, empty: "暂无推送记录", emptyIcon: "inbox" })));
    }

    function IntelTab(props) {
      var projectsS = useLoad(function () { return apiGet("/admin/projects"); }, []);
      var projects = (projectsS[0].data && projectsS[0].data.items) || [];
      var selS = react.useState("");
      var selected = selS[0], setSelected = selS[1];
      var viewS = react.useState("overview");
      var view = viewS[0], setView = viewS[1];
      react.useEffect(function () {
        if (!selected && projects.length) setSelected(String(projects[0].id));
      }, [projects.length, selected]);
      var project = null;
      for (var i = 0; i < projects.length; i += 1) if (String(projects[i].id) === String(selected)) project = projects[i];
      var summaryS = useLoad(function () { return selected ? apiGet("/admin/intel/summary" + qs({ projectId: selected })) : Promise.resolve(null); }, [selected]);
      var summary = summaryS[0].data || {};
      var sourcesS = useLoad(function () { return apiGet("/admin/intel/sources"); }, []);
      var sources = (sourcesS[0].data && sourcesS[0].data.items) || [];
      function reloadAll() { projectsS[1](); summaryS[1](); sourcesS[1](); }
      var body = null;
      if (view === "overview") {
        body = summaryS[0].loading
          ? h("div", { className: "ocMetrics", role: "status", "aria-busy": "true", "aria-label": t("panel.loading") }, [0, 1, 2, 3, 4, 5, 6].map(function (k) { return h("div", { className: "ocMetric", key: k }, h("span", { className: "ocSkel", style: { width: "60%", display: "block" } }), h("span", { className: "ocSkel", style: { width: "40%", height: 20, display: "block", marginTop: 8 } })); }))
          : h(Fragment, null,
          h(KpiGrid, { items: [
            { label: "活跃来源", value: summary.sourcesActive || 0, tone: (summary.sourcesActive || 0) > 0 ? "ok" : "" },
            { label: "异常来源", value: summary.sourcesBlocked || 0, tone: (summary.sourcesBlocked || 0) > 0 ? "bad" : "" },
            { label: "新采集", value: summary.itemsCollected || 0, tone: (summary.itemsCollected || 0) > 0 ? "warn" : "" },
            { label: "已分析", value: summary.itemsAnalyzed || 0 },
            { label: "已入日报", value: summary.itemsBriefed || 0, tone: (summary.itemsBriefed || 0) > 0 ? "ok" : "" },
            { label: "7 天日报", value: summary.briefsLast7d || 0 },
            { label: "24h 流水线失败", value: summary.pipelineFailures24h || 0, tone: (summary.pipelineFailures24h || 0) > 0 ? "bad" : "ok" },
          ] }),
          summary.hasScope
            ? h("div", { className: "ocSection" },
                h("div", { className: "ocH" }, "情报空间", h("span", { className: "ocCount" }, summary.scope ? summary.scope.name : "")),
                h("div", { className: "ocMeta" },
                  h(Badge, { tone: toneOf(summary.scope.status) }, summary.scope.status),
                  h("span", { className: "ocMuted" }, "日报 " + (summary.scope.briefTime || "-")),
                  h("span", { className: "ocMuted" }, "回看 " + (summary.scope.lookbackHours || "-") + "h"),
                  h("span", { className: "ocMuted" }, "上限 " + (summary.scope.maxItems || "-") + " 条"),
                  h("span", { className: "ocMono" }, summary.scope.timezone || "")),
                h("div", { className: "ocHint" }, "推送渠道：" + fmtVal(summary.scope.pushChannels) + " · 最近日报：" + fmtTime(summary.latestBriefAt)),
                h("div", { className: "ocStickyActions" },
                  h(Btn, { onClick: function () { setView("scopes"); } }, "编辑情报空间"),
                  h(Btn, { onClick: function () { setView("items"); } }, "查看条目"),
                  h(Btn, { onClick: function () { setView("runs"); } }, "运行流水线")))
            : h(EmptyState, { title: "尚未创建情报空间", hint: "先为当前项目创建情报空间，配置日报时间、回看窗口与推送渠道。", icon: "target", action: h(Btn, { kind: "primary", onClick: function () { setView("scopes"); } }, "创建情报空间") }));
      } else if (view === "scopes") {
        body = h(CrudSection, { key: selected + "-scopes", scope: "intel", projectId: selected, resource: "scopes", ui: INTEL_UI.scopes, flash: props.flash });
      } else if (view === "sources") {
        body = h(Fragment, null,
          h(CrudSection, { key: "intel-sources", scope: "intel", projectId: selected, resource: "sources", ui: INTEL_UI.sources, flash: props.flash, onChanged: function () { sourcesS[1](); summaryS[1](); } }),
          h(CrudSection, { key: selected + "-bindings", scope: "intel", projectId: selected, resource: "bindings", ui: bindingsUi(sources), flash: props.flash, onChanged: function () { summaryS[1](); } }));
      } else if (view === "topics") {
        body = h(CrudSection, { key: selected + "-topics", scope: "intel", projectId: selected, resource: "topics", ui: INTEL_UI.topics, flash: props.flash });
      } else if (view === "tags") {
        body = h(CrudSection, { key: selected + "-tags", scope: "intel", projectId: selected, resource: "tags", ui: INTEL_UI.tags, flash: props.flash });
      } else if (view === "items") {
        body = h(IntelItemsSection, { key: "items-" + selected, projectId: selected, flash: props.flash, onChanged: function () { summaryS[1](); } });
      } else if (view === "briefs") {
        body = h(IntelBriefsSection, { key: "briefs-" + selected, projectId: selected, flash: props.flash });
      } else {
        body = h(IntelRunsSection, { key: "runs-" + selected, projectId: selected, flash: props.flash, onChanged: function () { summaryS[1](); } });
      }
      return h(Fragment, null,
        h(PageHeader, { title: "情报管理", subtitle: projects.length + " 个项目 · 数据源、关注主题、日报与五阶段流水线" },
          h(Select, { label: "当前项目", value: selected, options: projects.map(function (p) { return { value: String(p.id), label: p.name + " · " + p.stage }; }), onChange: setSelected }),
          h(Btn, { onClick: reloadAll }, h(Icon, { name: "refresh", size: 14 }), t("panel.refresh"))),
        h(ErrLine, { error: projectsS[0].error || summaryS[0].error, onRetry: reloadAll }),
        project
          ? h(Fragment, null,
              h("div", { className: "ocSeg", role: "group", "aria-label": "情报管理视图" },
                INTEL_VIEWS.map(function (item) {
                  var on = item.id === view;
                  return h("button", { key: item.id, type: "button", className: "ocSegItem" + (on ? " on" : ""), "aria-pressed": on ? "true" : "false", onClick: function () { setView(item.id); } }, item.label);
                })),
              body)
          : projectsS[0].loading
            ? h(SkeletonTable, { columns: [{ key: "a" }, { key: "b" }, { key: "c" }], rows: 4 })
            : h(EmptyState, { title: "还没有项目", hint: "情报空间按项目划分，请先在「项目管理」新建项目。", icon: "target" }));
    }

    // ================= 自动驾驶 =================
    function AutopilotTab(props) {
      var projectsS = useLoad(function () { return apiGet("/admin/projects"); }, []);
      var projects = (projectsS[0].data && projectsS[0].data.items) || [];
      var selS = react.useState("");
      var selected = selS[0], setSelected = selS[1];
      react.useEffect(function () {
        if (!selected && projects.length) setSelected(String(projects[0].id));
      }, [projects.length, selected]);
      var sumS = useLoad(function () { return selected ? apiGet("/admin/projects/" + selected + "/autopilot") : Promise.resolve(null); }, [selected]);
      var sum = (sumS[0].data && sumS[0].data) || {};
      var reposS = useLoad(function () { return selected ? apiGet("/admin/projects/" + selected + "/repositories") : Promise.resolve(null); }, [selected]);
      var repos = (reposS[0].data && reposS[0].data.items) || [];
      var formS = react.useState({ name: "", repositoryUrl: "", branch: "main", authRef: "", healthUrl: "", scaffold: true, pipeline: true, deployTest: true });
      var form = formS[0], setForm = formS[1];
      var busyS = react.useState(false);
      var busy = busyS[0], setBusy = busyS[1];
      var decideS = react.useState(null);
      var deciding = decideS[0], setDeciding = decideS[1];
      function up(key, value) { var next = Object.assign({}, form); next[key] = value; setForm(next); }
      function knownRepoUrl() {
        if (repos.length > 0 && repos[0].url) return repos[0].url;
        var profile = (sum.profile && sum.profile.software_profile) || null;
        return (profile && profile.repositoryUrl) || "";
      }
      react.useEffect(function () {
        if (!selected) return;
        var url = knownRepoUrl();
        if (url && !form.repositoryUrl) up("repositoryUrl", url);
      }, [selected, repos.length, sum.profile]);
      function refreshAll() { projectsS[1](); if (selected) sumS[1](); }
      function run() {
        if (!form.repositoryUrl) { props.flash("请先填写版本库地址", false); return; }
        setBusy(true);
        apiPost("/admin/projects", {
          name: form.name || ("自动生产-" + new Date().toISOString().slice(5, 16)),
          stage: "planning",
          repository: { url: form.repositoryUrl, branch: form.branch || undefined, authRef: form.authRef || undefined },
          autopilotOptions: { scaffold: form.scaffold, pipeline: form.pipeline, deployTest: form.deployTest, healthUrl: form.healthUrl || undefined },
        }).then(function (r) {
          var ap = r.autopilot || {};
          var parts = [];
          if (ap.checkout) parts.push("检出 " + String(ap.checkout.commit || "").slice(0, 8));
          if (ap.scaffold) parts.push("骨架 " + ap.scaffold.status);
          if (ap.pipeline) parts.push("流水线 " + ap.pipeline.status);
          if (ap.deploy) parts.push("测试环境 " + ap.deploy.status);
          props.flash("自动生产完成：" + (parts.join(" · ") || "已创建"));
          if (r.id) setSelected(String(r.id));
          refreshAll();
        }).catch(function (e) { props.flash(e.message || String(e), false); })
          .then(function () { setBusy(false); });
      }
      function runExisting() {
        if (!selected) { props.flash("先选一个项目", false); return; }
        if (!form.repositoryUrl) { props.flash("请先填写版本库地址", false); return; }
        setBusy(true);
        apiPost("/admin/projects/" + selected + "/autopilot", {
          repository: { url: form.repositoryUrl, branch: form.branch || undefined, authRef: form.authRef || undefined },
          options: { scaffold: form.scaffold, pipeline: form.pipeline, deployTest: form.deployTest, healthUrl: form.healthUrl || undefined },
        }).then(function (r) {
          var parts = [];
          if (r.checkout) parts.push("检出 " + String(r.checkout.commit || "").slice(0, 8));
          if (r.scaffold) parts.push("骨架 " + r.scaffold.status);
          if (r.pipeline) parts.push("流水线 " + r.pipeline.status);
          if (r.deploy) parts.push("测试环境 " + r.deploy.status);
          if (r.repository && r.repository.reused) parts.push("复用已登记版本库");
          props.flash("已执行：" + (parts.join(" · ") || "完成") + "（计划版本递增）");
          sumS[1](); reposS[1]();
        }).catch(function (e) { props.flash(e.message || String(e), false); })
          .then(function () { setBusy(false); });
      }
      function rerunDeploy() {
        setBusy(true);
        apiPost("/admin/projects/" + selected + "/deploy-test", {})
          .then(function (r) { props.flash("测试环境发布：" + r.status); sumS[1](); })
          .catch(function (e) { props.flash(e.message || String(e), false); })
          .then(function () { setBusy(false); });
      }
      function submitDecision(decisionId) {
        var text = deciding && deciding.text ? deciding.text : "";
        if (!text) { props.flash("请填写裁决内容", false); return; }
        apiPost("/admin/projects/" + selected + "/decisions/" + decisionId + "/decide", { decision: text, decidedBy: "老板" })
          .then(function () { props.flash("已裁决"); setDeciding(null); sumS[1](); })
          .catch(function (e) { props.flash(e.message || String(e), false); });
      }
      var plans = sum.plans || [];
      var decisions = sum.decisions || [];
      var pending = decisions.filter(function (d) { return d.status === "pending"; });
      var pipeline = sum.pipeline || [];
      var deploy = sum.deploy || [];
      var checkout = sum.checkout;
      var scanFindings = (sum.scan && sum.scan.findings) || {};
      var tech = (sum.profile && sum.profile.tech_stack) || {};
      return h(Fragment, null,
        h(PageHeader, { title: "自动驾驶", subtitle: "填写版本库 → 检出 → 扫描 → 骨架 → 测试流水线 → 计划 → 测试环境；只有裁决项等人" },
          h(Select, { label: "当前项目", value: selected, options: projects.map(function (p) { return { value: String(p.id), label: p.name + " · " + p.stage }; }), onChange: setSelected }),
          h(Btn, { onClick: refreshAll }, h(Icon, { name: "refresh", size: 14 }), t("panel.refresh"))),
        h(ErrLine, { error: projectsS[0].error || sumS[0].error, onRetry: refreshAll }),
        h(Card, null,
          h("div", { className: "ocH" }, "新建项目并自动生产"),
          h("div", { className: "ocFormRow" },
            h(Field, { label: "项目名称", value: form.name, onChange: function (v) { up("name", v); } }),
            h(Field, { label: "版本库地址", value: form.repositoryUrl, onChange: function (v) { up("repositoryUrl", v); }, placeholder: "https://… / file:///…" }),
            h(Field, { label: "分支", value: form.branch, onChange: function (v) { up("branch", v); } }),
            h(Field, { label: "凭据引用（env:）", value: form.authRef, onChange: function (v) { up("authRef", v); }, placeholder: "env:GIT_TOKEN" }),
            h(Field, { label: "健康检查 URL", value: form.healthUrl, onChange: function (v) { up("healthUrl", v); }, placeholder: "http://host:port/health" })),
          h("div", { className: "ocRow" },
            h("label", { className: "ocMuted" }, h("input", { type: "checkbox", checked: form.scaffold, onChange: function (e) { up("scaffold", e.target.checked); } }), " 生成代码骨架"),
            h("label", { className: "ocMuted" }, h("input", { type: "checkbox", checked: form.pipeline, onChange: function (e) { up("pipeline", e.target.checked); } }), " 跑测试流水线"),
            h("label", { className: "ocMuted" }, h("input", { type: "checkbox", checked: form.deployTest, onChange: function (e) { up("deployTest", e.target.checked); } }), " 发测试环境"),
            h(Btn, { kind: "primary", disabled: busy, onClick: run }, busy ? "执行中…" : "开始自动生产"))),
        !selected ? null : h(Card, null,
          h("div", { className: "ocH" }, "对已选项目执行自动驾驶"),
          h("div", { className: "ocMuted" }, "已建项目也能走同一条流水线：检出 → 扫描 → 回填档案 → 计划（版本递增）→ 可选骨架/流水线/测试环境发布；不会重复建版本库、里程碑、测试计划与裁决。"),
          h("div", { className: "ocFormRow" },
            h(Field, { label: "版本库地址", value: form.repositoryUrl, onChange: function (v) { up("repositoryUrl", v); }, placeholder: "https://… / file:///…" }),
            h(Field, { label: "分支", value: form.branch, onChange: function (v) { up("branch", v); } }),
            h(Field, { label: "凭据引用（env:）", value: form.authRef, onChange: function (v) { up("authRef", v); }, placeholder: "env:GIT_TOKEN" }),
            h(Btn, { kind: "primary", disabled: busy, onClick: runExisting }, busy ? "执行中…" : "在现有项目执行")),
          repos.length > 0 ? h("div", { className: "ocMuted" }, "已登记版本库：" + repos.map(function (r) { return r.name + "（" + r.url + "）"; }).join("；")) : null),
        !selected ? null : h(Fragment, null,
          h(KpiGrid, { items: [
            { label: "检出", value: checkout && checkout.status === "ok" ? 1 : 0, unit: checkout && checkout.status === "ok" ? "ok" : "", tone: checkout && checkout.status === "ok" ? "ok" : "warn" },
            { label: "源码文件", value: (checkout && checkout.file_count) || 0 },
            { label: "主语言", value: tech.primaryLanguage || "-" },
            { label: "计划", value: plans.length },
            { label: "待裁决", value: pending.length, tone: pending.length > 0 ? "warn" : "ok" },
            { label: "流水线失败", value: pipeline.filter(function (r) { return r.status === "failed"; }).length, tone: pipeline.some(function (r) { return r.status === "failed"; }) ? "bad" : "ok" },
            { label: "测试环境", value: deploy.length ? deploy[0].status : "-", tone: deploy.length && deploy[0].status === "ok" ? "ok" : "warn" },
          ] }),
          h(Card, null,
            h("div", { className: "ocH" }, "检出与扫描"),
            h("div", { className: "ocMuted" }, checkout ? ("commit " + String(checkout.commit_sha || "").slice(0, 12) + " · 文件 " + (checkout.file_count || 0) + " · 字节 " + (checkout.size_bytes || 0) + " · 分支 " + (checkout.branch || "-")) : "尚未检出"),
            h("div", { className: "ocMuted" }, "语言：" + Object.keys((sum.scan && sum.scan.languages) || {}).join(" / ") + "；测试：" + (((sum.scan && sum.scan.tests) || []).length) + "；CI：" + (((sum.scan && sum.scan.ci) || []).length)),
            h("div", { className: "ocMuted" }, "缓存排除：" + Object.keys(scanFindings).length + " 项扫描证据")),
          h(Card, null,
            h("div", { className: "ocH" }, "开发/测试/部署计划"),
            h(Table, { columns: [
              { key: "plan_kind", label: "类型", render: function (r) { return h(Badge, { tone: "mute" }, r.plan_kind); } },
              { key: "title", label: "标题" },
              { key: "version", label: "版本" },
              { key: "status", label: "状态", render: function (r) { return h(Badge, { tone: r.status === "active" ? "ok" : "mute" }, r.status); } },
            ], rows: plans, empty: "还没有自动计划", emptyHint: "执行自动生产后会生成开发/测试/部署计划。", emptyIcon: "layers" })),
          h(Card, null,
            h("div", { className: "ocH" }, "测试流水线与骨架"),
            h(Table, { columns: [
              { key: "stage", label: "阶段" },
              { key: "command", label: "命令" },
              { key: "status", label: "状态", render: function (r) { return h(Badge, { tone: r.status === "ok" ? "ok" : r.status === "failed" ? "bad" : "mute" }, r.status); } },
              { key: "exit_code", label: "退出码" },
            ], rows: pipeline, empty: "还没跑过流水线", emptyHint: "自动生产默认会跑仓库既有的 lint/build/test 脚本。", emptyIcon: "flow" })),
          h(Card, null,
            h("div", { className: "ocH" }, "测试环境发布"),
            h("div", { className: "ocRow" },
              h(Btn, { kind: "primary", disabled: busy, onClick: rerunDeploy }, "发布到测试环境")),
            h(Table, { columns: [
              { key: "status", label: "状态", render: function (r) { return h(Badge, { tone: r.status === "ok" ? "ok" : r.status === "failed" ? "bad" : "mute" }, r.status); } },
              { key: "release_id", label: "发布单" },
              { key: "exit_code", label: "退出码" },
              { key: "health_url", label: "健康检查" },
            ], rows: deploy, empty: "还没发布过测试环境", emptyHint: "配置 OPC_TEST_DEPLOY_CMD 后可自动发布。", emptyIcon: "layers" })),
          h(Card, null,
            h("div", { className: "ocH" }, "待裁决（" + pending.length + "）"),
            pending.length ? pending.map(function (d) {
              var editing = deciding && deciding.id === d.id;
              return h("div", { key: d.id, className: "ocSection" },
                h("div", { className: "ocRow" },
                  h(Badge, { tone: d.risk_level === "high" ? "bad" : d.risk_level === "medium" ? "warn" : "mute" }, d.risk_level || "low"),
                  h("b", null, d.topic),
                  h("span", { style: { flex: 1 } }, d.question),
                  h(Btn, { onClick: function () { setDeciding(editing ? null : { id: d.id, text: "" }); } }, editing ? "取消" : "裁决")),
                editing ? h("div", { className: "ocFormRow" },
                  h(Field, { label: "裁决内容", value: deciding.text, onChange: function (v) { setDeciding({ id: d.id, text: v }); } }),
                  h(Btn, { kind: "primary", onClick: function () { submitDecision(d.id); } }, "确认裁决")) : null);
            }) : h("div", { className: "ocMuted" }, "没有待裁决事项：自动化不需要你拍板。"))));
    }

    // ================= 主控制台 =================
    // 导航按“概览 / 经营 / 治理 / 知识 / 系统”分组，降低 12 个页签的认知负担。
    var NAV_GROUPS = [
      { title: "概览", items: [{ id: "cockpit", label: "驾驶舱", icon: "gauge" }, { id: "domains", label: "业务域", icon: "grid" }] },
      { title: "经营", items: [{ id: "employees", label: "员工矩阵", icon: "users" }, { id: "projects", label: "项目管理", icon: "layers" }, { id: "autopilot", label: "自动驾驶", icon: "target" }, { id: "workflows", label: "流程", icon: "flow" }, { id: "tasks", label: "任务", icon: "clock" }] },
      { title: "治理", items: [{ id: "audits", label: "审计", icon: "shield" }, { id: "conflicts", label: "冲突", icon: "alert" }, { id: "inbox", label: "收件箱", icon: "inbox" }] },
      { title: "知识", items: [{ id: "memory", label: "记忆", icon: "book" }, { id: "hindsight", label: "记忆同步", icon: "sync" }, { id: "radar", label: "雷达", icon: "radar" }, { id: "intel", label: "情报管理", icon: "target" }] },
      { title: "系统", items: [{ id: "settings", label: "设置", icon: "settings" }] },
    ];
    var TABS = [];
    NAV_GROUPS.forEach(function (g) { g.items.forEach(function (x) { TABS.push(x); }); });

    function Console() {
      var tabS = react.useState("cockpit");
      var tab = tabS[0], setTab = tabS[1];
      var flashS = react.useState({ msg: "", ok: true });
      var flash = flashS[0], setFlash = flashS[1];
      var timerRef = react.useRef(null);
      function dismiss() {
        if (timerRef.current) clearTimeout(timerRef.current);
        setFlash({ msg: "", ok: true });
      }
      function flashMsg(msg, ok) {
        setFlash({ msg: msg, ok: ok !== false });
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(function () { setFlash({ msg: "", ok: true }); }, 5000);
      }
      react.useEffect(function () {
        return function () { if (timerRef.current) clearTimeout(timerRef.current); };
      }, []);
      function onNavKeyDown(e) {
        var keys = ["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft", "Home", "End"];
        if (keys.indexOf(e.key) < 0) return;
        var items = Array.prototype.slice.call(e.currentTarget.querySelectorAll('[role="tab"]'));
        if (!items.length) return;
        var idx = items.indexOf(document.activeElement);
        if (idx < 0) idx = 0;
        e.preventDefault();
        var next = idx;
        if (e.key === "Home") next = 0;
        else if (e.key === "End") next = items.length - 1;
        else if (e.key === "ArrowDown" || e.key === "ArrowRight") next = (idx + 1) % items.length;
        else next = (idx - 1 + items.length) % items.length;
        items[next].focus();
        var id = items[next].getAttribute("data-tab");
        if (id) setTab(id);
      }

      var body = null;
      if (tab === "cockpit") body = h(CockpitTab, { flash: flashMsg });
      else if (tab === "employees") body = h(EmployeesTab, { flash: flashMsg });
      else if (tab === "projects") body = h(ProjectsTab, { flash: flashMsg });
      else if (tab === "autopilot") body = h(AutopilotTab, { flash: flashMsg });
      else if (tab === "intel") body = h(IntelTab, { flash: flashMsg });
      else if (tab === "domains") body = h(DomainsTab, { flash: flashMsg });
      else if (tab === "workflows") body = h(WorkflowsTab, { flash: flashMsg });
      else if (tab === "tasks") body = h(TasksTab, { flash: flashMsg });
      else if (tab === "audits") body = h(AuditsTab, { flash: flashMsg });
      else if (tab === "conflicts") body = h(ConflictsTab, { flash: flashMsg });
      else if (tab === "inbox") body = h(InboxTab, { flash: flashMsg });
      else if (tab === "memory") body = h(MemoryTab, { flash: flashMsg });
      else if (tab === "hindsight") body = h(HindsightTab, { flash: flashMsg });
      else if (tab === "radar") body = h(RadarTab, { flash: flashMsg });
      else body = h(SettingsTab, { flash: flashMsg });

      return h("div", { className: "ocRoot" },
        h(StyleTag),
        h("div", { className: "ocShell" },
          h("header", { className: "ocHead" },
            h("div", { className: "ocBrand" },
              h("div", { className: "ocBrandMark" }, h(Icon, { name: "gauge", size: 18 })),
              h("div", null,
                h("h1", { className: "ocTitle" }, t("panel.title")),
                h("div", { className: "ocSub" }, t("panel.sub"))))),
          h("nav", { className: "ocNav", role: "tablist", "aria-label": "控制台模块", onKeyDown: onNavKeyDown },
            NAV_GROUPS.map(function (g) {
              return h("div", { className: "ocNavGroup", role: "presentation", key: g.title },
                h("div", { className: "ocNavGroupTitle" }, g.title),
                g.items.map(function (x) {
                  var on = x.id === tab;
                  return h("button", {
                    key: x.id, type: "button", role: "tab", id: "oc-tab-" + x.id, "data-tab": x.id,
                    className: "ocNavItem", "aria-selected": on ? "true" : "false",
                    "aria-controls": "oc-panel-" + x.id, tabIndex: on ? 0 : -1,
                    onClick: function () { setTab(x.id); },
                  },
                    h("span", { className: "ocNavIcon" }, h(Icon, { name: x.icon })),
                    h("span", { className: "ocNavLabel" }, x.label));
                }));
            })),
          h("main", { className: "ocMain" },
            h("div", { className: "ocBody", key: tab, id: "oc-panel-" + tab, role: "tabpanel", "aria-labelledby": "oc-tab-" + tab, tabIndex: 0 }, body))),
        flash.msg ? h("div", { className: "ocToast" + (flash.ok ? "" : " bad"), role: flash.ok ? "status" : "alert", "aria-live": flash.ok ? "polite" : "assertive" },
          h("span", { className: "ocToastMsg" }, flash.msg),
          h("button", { type: "button", className: "ocToastClose", onClick: dismiss, "aria-label": t("panel.close") }, h(Icon, { name: "x", size: 12 }))) : null);
    }

    // ---- 左栏入口图标 ----
    function SidebarIcon(props) {
      return h(Icon, { name: "gauge", size: props && props.size ? props.size : 16 });
    }

    function slotDeclared(ctx, name) {
      try {
        var slots = ctx && ctx.slots;
        if (!slots) return false;
        if (typeof slots.specDynamic === "function") return !!slots.specDynamic(name);
        if (typeof slots.spec === "function") return !!slots.spec(name);
      } catch (e) { /* treat as undeclared */ }
      return false;
    }

    function apply(ctx) {
      var localeSub = null;
      var applyLocale = function () {
        try {
          var snap = ctx && ctx.locale && typeof ctx.locale.getSnapshot === "function" ? ctx.locale.getSnapshot() : null;
          localeId = snap && typeof snap.active === "string" ? snap.active.split("-")[0] : "";
        } catch (e) { localeId = ""; }
      };
      try {
        applyLocale();
        if (ctx && ctx.locale && typeof ctx.locale.subscribe === "function") localeSub = ctx.locale.subscribe(function () { applyLocale(); });
      } catch (e) { /* locale optional */ }

      var disposers = [];
      // 直接 inject：ctx.slots.inject 会在槽声明后回调，无需前置 spec 探测
      // （探测时序不稳时会把注册整个跳过，导致入口消失）。
      function seat(slotName, register) {
        try {
          disposers.push(ctx.slots.inject(slotName, register));
        } catch (err) {
          console.warn("[opc-xuanji] panel seat failed (" + slotName + "):", err);
        }
      }
      if (ctx && ctx.slots && typeof ctx.slots.inject === "function") {
        seat("sidebar.panellist", function () {
          return ctx.slots.register({ name: "sidebar.panellist", id: PANEL_ID, order: PANEL_ORDER, label: "OPC驾驶舱" }, SidebarIcon);
        });
        seat("main", function () {
          return ctx.slots.register({ name: "main", key: PANEL_ID }, Console);
        });
      }
      return function () {
        for (var i = 0; i < disposers.length; i += 1) {
          try { disposers[i](); } catch (e) { /* ignore */ }
        }
        if (typeof localeSub === "function") { try { localeSub(); } catch (e) { /* ignore */ } }
      };
    }

    exports.apply = apply;
    exports.inject = inject;
    exports.PANEL_ID = PANEL_ID;
    return module.exports;
  },
});
