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
              h("div", { className: "ocH", style: { marginBottom: 6 } }, g),
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

    // ================= 主控制台 =================
    // 导航按“概览 / 经营 / 治理 / 知识 / 系统”分组，降低 12 个页签的认知负担。
    var NAV_GROUPS = [
      { title: "概览", items: [{ id: "cockpit", label: "驾驶舱", icon: "gauge" }, { id: "domains", label: "业务域", icon: "grid" }] },
      { title: "经营", items: [{ id: "employees", label: "员工矩阵", icon: "users" }, { id: "workflows", label: "流程", icon: "flow" }, { id: "tasks", label: "任务", icon: "clock" }] },
      { title: "治理", items: [{ id: "audits", label: "审计", icon: "shield" }, { id: "conflicts", label: "冲突", icon: "alert" }, { id: "inbox", label: "收件箱", icon: "inbox" }] },
      { title: "知识", items: [{ id: "memory", label: "记忆", icon: "book" }, { id: "hindsight", label: "记忆同步", icon: "sync" }, { id: "radar", label: "雷达", icon: "radar" }] },
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
