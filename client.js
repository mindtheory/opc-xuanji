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
        "panel.error": "加载失败", "panel.save": "保存", "panel.cancel": "取消", "panel.confirm": "确认", "panel.ignore": "忽略",
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
        "panel.error": "load failed", "panel.save": "Save", "panel.cancel": "Cancel", "panel.confirm": "Confirm", "panel.ignore": "Ignore",
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
    var CSS = [
      ".ocWrap{padding:12px;display:flex;flex-direction:column;gap:12px;font-size:13px;min-height:100%}",
      ".ocHead{display:flex;align-items:flex-start;gap:10px}",
      ".ocTitle{font-size:16px;font-weight:700;letter-spacing:.4px}",
      ".ocSub{opacity:.6;font-size:12px;margin-top:2px}",
      ".ocRight{margin-left:auto;display:flex;align-items:center;gap:8px}",
      ".ocBadge{border-radius:999px;padding:2px 10px;font-size:12px;border:1px solid rgba(128,128,128,.35);white-space:nowrap}",
      ".ocBadge.ok{color:#1a7f37;border-color:rgba(26,127,55,.45)}",
      ".ocBadge.warn{color:#b26a00;border-color:rgba(178,106,0,.5)}",
      ".ocBadge.bad{color:#b42318;border-color:rgba(180,35,24,.5)}",
      ".ocBadge.mute{opacity:.6}",
      ".ocBtn{border:1px solid rgba(128,128,128,.35);border-radius:8px;background:transparent;color:inherit;font-size:12px;padding:4px 10px;cursor:pointer;white-space:nowrap}",
      ".ocBtn:hover{background:rgba(128,128,128,.12)}",
      ".ocBtn.primary{border-color:rgba(64,128,255,.55);color:#3b82f6}",
      ".ocBtn.danger{border-color:rgba(180,35,24,.45);color:#b42318}",
      ".ocBtn:disabled{opacity:.4;cursor:default}",
      ".ocTabs{display:flex;gap:6px;flex-wrap:wrap;border-bottom:1px solid rgba(128,128,128,.25);padding-bottom:8px}",
      ".ocTab{border:1px solid rgba(128,128,128,.3);border-radius:8px;padding:3px 10px;font-size:12px;cursor:pointer;user-select:none;white-space:nowrap}",
      ".ocTab.on{background:rgba(128,128,128,.18);font-weight:600}",
      ".ocStrip{display:flex;flex-wrap:wrap;gap:8px}",
      ".ocChip{border:1px solid rgba(128,128,128,.25);border-radius:8px;padding:5px 9px;display:flex;align-items:center;gap:6px;font-size:12px}",
      ".ocDot{width:7px;height:7px;border-radius:50%;display:inline-block;flex:0 0 auto}",
      ".ocDot.ok{background:#1a7f37}.ocDot.bad{background:#b42318}.ocDot.mute{background:#8a8a8a}",
      ".ocMetrics{display:flex;gap:10px;flex-wrap:wrap}",
      ".ocMetric{flex:1 1 120px;min-width:110px;border:1px solid rgba(128,128,128,.25);border-radius:10px;padding:8px}",
      ".ocMetric b{display:block;font-size:18px;line-height:1.3;font-weight:650}",
      ".ocMetric span{opacity:.6;font-size:11px}",
      ".ocCard{border:1px solid rgba(128,128,128,.25);border-radius:10px;padding:10px;display:flex;flex-direction:column;gap:8px}",
      ".ocGrid2{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px}",
      ".ocH{font-weight:600;font-size:13px;display:flex;align-items:center;gap:8px}",
      ".ocCount{margin-left:auto;opacity:.55;font-size:11px;font-weight:400}",
      ".ocMuted{opacity:.6;font-size:12px}",
      ".ocRow{display:flex;align-items:center;gap:8px;font-size:12px;flex-wrap:wrap}",
      ".ocList{display:flex;flex-direction:column;gap:6px}",
      ".ocEllip{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1}",
      ".ocMono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;opacity:.85}",
      ".ocErr{color:#b42318;font-size:12px;border:1px solid rgba(180,35,24,.35);border-radius:8px;padding:8px}",
      ".ocEmpty{opacity:.55;font-size:12px}",
      ".ocFrozen{border:1px solid rgba(178,106,0,.4);border-radius:8px;padding:6px 10px;font-size:12px;color:#b26a00}",
      ".ocFoot{display:flex;gap:12px;flex-wrap:wrap;opacity:.55;font-size:11px;margin-top:2px}",
      ".ocTable{width:100%;border-collapse:collapse;font-size:12px}",
      ".ocTable th{text-align:left;font-weight:600;opacity:.65;padding:6px 8px;border-bottom:1px solid rgba(128,128,128,.25);white-space:nowrap}",
      ".ocTable td{padding:6px 8px;border-bottom:1px solid rgba(128,128,128,.12);vertical-align:top}",
      ".ocTable tr:hover td{background:rgba(128,128,128,.07)}",
      ".ocScroll{overflow:auto;max-height:460px}",
      ".ocField{display:flex;flex-direction:column;gap:4px;font-size:12px}",
      ".ocField label{opacity:.7}",
      ".ocField input,.ocField select,.ocField textarea{border:1px solid rgba(128,128,128,.35);border-radius:8px;background:transparent;color:inherit;font-size:12px;padding:5px 8px;font-family:inherit}",
      ".ocField textarea{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;min-height:64px;resize:vertical}",
      ".ocFormRow{display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end}",
      ".ocFormRow>.ocField{flex:1 1 140px;min-width:120px}",
      ".ocFlash{position:sticky;bottom:8px;border:1px solid rgba(64,128,255,.4);border-radius:8px;padding:6px 10px;font-size:12px;background:rgba(64,128,255,.08)}",
      ".ocFlash.bad{border-color:rgba(180,35,24,.45);color:#b42318;background:rgba(180,35,24,.06)}",
      ".ocSection{border:1px solid rgba(128,128,128,.2);border-radius:10px;padding:10px;display:flex;flex-direction:column;gap:8px}",
      ".ocDomain{border:1px solid rgba(128,128,128,.25);border-radius:10px;padding:10px;display:flex;flex-direction:column;gap:6px}",
      ".ocDomainName{font-weight:600;font-size:13px;display:flex;align-items:center;gap:6px}",
      ".ocDomainName span{opacity:.55;font-size:11px;font-weight:400}",
    ].join("\n");

    function StyleTag() { return h("style", null, CSS); }

    // ================= shared components =================
    function Btn(props) {
      return h("button", { className: "ocBtn" + (props.kind ? " " + props.kind : ""), onClick: props.onClick, disabled: props.disabled }, props.children || props.label);
    }
    function Badge(props) { return h("span", { className: "ocBadge " + (props.tone || "mute") }, props.children); }
    function Card(props) { return h("div", { className: "ocCard" }, props.children); }
    function Dot(props) { return h("span", { className: "ocDot " + (props.state || "mute") }); }
    function Field(props) {
      return h("div", { className: "ocField" }, h("label", null, props.label),
        h("input", { value: props.value, onChange: function (e) { props.onChange(e.target.value); }, placeholder: props.placeholder || "", type: props.type || "text" }));
    }
    function NumField(props) {
      return h("div", { className: "ocField" }, h("label", null, props.label),
        h("input", { value: props.value, type: "number", onChange: function (e) { props.onChange(Number(e.target.value)); } }));
    }
    function Area(props) {
      return h("div", { className: "ocField" }, h("label", null, props.label),
        h("textarea", { value: props.value, onChange: function (e) { props.onChange(e.target.value); }, placeholder: props.placeholder || "", rows: props.rows || 4 }));
    }
    function Select(props) {
      return h("div", { className: "ocField" }, h("label", null, props.label),
        h("select", { value: props.value, onChange: function (e) { props.onChange(e.target.value); } },
          (props.options || []).map(function (o) { return h("option", { key: o.value, value: o.value }, o.label); })));
    }
    function Table(props) {
      var cols = props.columns;
      var rows = props.rows || [];
      if (!rows.length) return h("div", { className: "ocEmpty" }, props.empty || t("panel.empty"));
      return h("div", { className: "ocScroll" },
        h("table", { className: "ocTable" },
          h("thead", null, h("tr", null, cols.map(function (c) { return h("th", { key: c.key }, c.label); }))),
          h("tbody", null, rows.map(function (r, i) {
            return h("tr", { key: r.__key || i }, cols.map(function (c) { return h("td", { key: c.key }, c.render ? c.render(r) : fmtVal(r[c.key])); }));
          }))));
    }
    function ErrLine(props) {
      return props.error ? h("div", { className: "ocErr" }, t("panel.error") + "：" + props.error) : null;
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
      react.useEffect(function () {
        var alive = true;
        setReport({ loading: true, error: "", data: null });
        apiGet("/reports/daily").then(function (d) { if (alive) setReport({ loading: false, error: "", data: d }); })
          .catch(function (e) { if (alive) setReport({ loading: false, error: String((e && e.message) || e), data: null }); });
        return function () { alive = false; };
      }, []);

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
        h("div", { className: "ocStrip" },
          h("div", { className: "ocChip" }, h(Dot, { state: health.pg ? "ok" : "bad" }), t("panel.pg")),
          h("div", { className: "ocChip" }, h(Dot, { state: health.pgvector ? "ok" : "bad" }), t("panel.pgvector") + (health.pgvectorVersion ? " " + health.pgvectorVersion : "")),
          h("div", { className: "ocChip" }, h(Dot, { state: health.scheduler ? "ok" : "mute" }), t("panel.tasks") + " " + ((health.scheduler && health.scheduler.enabled) || 0) + "/" + ((health.scheduler && health.scheduler.registered) || 0)),
          h("div", { className: "ocChip" }, h(Dot, { state: agents.reachable ? (agents.paused ? "mute" : "ok") : "bad" }),
            t("panel.agents") + " " + (agents.reachable ? (agents.paused ? t("panel.agentsPaused") : t("panel.queue") + " " + (agents.queue || 0) + " · " + t("panel.running") + " " + (agents.active || 0)) : "—"))),
        h(ErrLine, { error: dashS[0].error || healthS[0].error }),
        h("div", { className: "ocTabs", style: { borderBottom: "none", paddingBottom: 0 } },
          ranges.map(function (r) { return h("span", { key: r, className: "ocTab" + (r === range ? " on" : ""), onClick: function () { setRange(r); } }, t("panel.range." + r)); })),
        dash ? h("div", null,
          groupOrder.map(function (g) {
            return h("div", { key: g },
              h("div", { className: "ocH", style: { marginBottom: 6 } }, g),
              h("div", { className: "ocMetrics" }, groups[g].map(function (m) {
                return h("div", { className: "ocMetric", key: m.id, title: m.source || "" },
                  h("span", null, m.label), h("b", null, fmtNum(m.value) + (m.unit ? " " + m.unit : "")));
              })));
          }),
          dash.frozen && dash.frozen.count > 0 ? h("div", { className: "ocFrozen" }, t("panel.frozen") + " " + dash.frozen.count + " · " + fmtNum(dash.frozen.amount) + "（" + t("panel.frozenHint") + "）") : null) : null,
        h("div", { className: "ocSection" },
          h("div", { className: "ocH" }, "晨报", h("span", { className: "ocCount" }, report.data ? fmtTime(report.data.sent_at) : "")),
          report.error ? h("div", { className: "ocEmpty" }, report.error) : null,
          report.data ? h("pre", { className: "ocMono", style: { whiteSpace: "pre-wrap", margin: 0 } }, JSON.stringify(report.data.content, null, 2)) : h("div", { className: "ocEmpty" }, t("panel.loading"))),
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
        h("div", { className: "ocRow" },
          h("span", null, "员工矩阵：", h("b", null, String(catalog.length)), " 个员工 · 已安装 " + installed.length),
          h("span", { style: { flex: 1 } }),
          h(Badge, { tone: agents.reachable ? (agents.paused ? "warn" : "ok") : "bad" }, "智能体 " + (agents.reachable ? (agents.paused ? "已暂停" : "可达") : "不可达")),
          h(Btn, { onClick: function () { empS[1](); runsS[1](); healthS[1](); } }, t("panel.refresh"))),
        h(ErrLine, { error: empS[0].error || runsS[0].error }),
        h(Card, null, h("div", { className: "ocH" }, "员工目录", h("span", { className: "ocCount" }, String(catalog.length))), h(Table, { columns: cols, rows: catalog })),
        h("div", { className: "ocSection" },
          h("div", { className: "ocH" }, t("panel.dispatch")),
          h("div", { className: "ocFormRow" },
            h(Select, { label: t("panel.dispatchFor"), value: dispatch.pluginId, options: [{ value: "", label: "选择员工" }].concat(catalog.map(function (r) { return { value: r.pluginId, label: r.displayName }; })), onChange: function (v) { setDispatch({ pluginId: v, prompt: dispatch.prompt }); } }),
            h("div", { style: { flex: 3 } }, h(Field, { label: "任务", value: dispatch.prompt, placeholder: t("panel.taskPlaceholder"), onChange: function (v) { setDispatch({ pluginId: dispatch.pluginId, prompt: v }); } })),
            h(Btn, { kind: "primary", disabled: busy || !dispatch.pluginId || !dispatch.prompt.trim(), onClick: function () { run(apiPost("/agents/dispatch", { pluginId: dispatch.pluginId, prompt: dispatch.prompt }), "已派活"); setDispatch({ pluginId: dispatch.pluginId, prompt: "" }); } }, t("panel.dispatch"))),
          h("div", { className: "ocMuted" }, "认知任务在员工超级智能体会话中执行，产物文件回传运行记录；需先部署角色卡。")),
        h(Card, null, h("div", { className: "ocH" }, t("panel.runs"), h("span", { className: "ocCount" }, String(runs.length))), h(Table, { columns: runCols, rows: runs })),
        h("div", { className: "ocSection" },
          h("div", { className: "ocH" }, t("panel.import")),
          h(Area, { label: "员工包 JSON（先预检再导入）", value: imp.text, onChange: function (v) { setImp({ text: v }); } }),
          h("div", { className: "ocRow" },
            h(Btn, { disabled: busy, onClick: function () { run(apiPost("/employees/import", { package: parseJson(imp.text, {}), dryRun: true }), "预检完成"); } }, "预检"),
            h(Btn, { kind: "primary", disabled: busy, onClick: function () { run(apiPost("/employees/import", { package: parseJson(imp.text, {}), dryRun: false, confirm: true }), "导入完成（默认停用）"); } }, "确认导入"))));
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
        h("div", { className: "ocRow" },
          h("span", null, "业务域：9 个经营域 + 平台域，指标来自驾驶舱聚合（只读）"),
          h("span", { style: { flex: 1 } }),
          h(Btn, { onClick: function () { dashS[1](); } }, t("panel.refresh"))),
        h(ErrLine, { error: dashS[0].error }),
        h("div", { className: "ocGrid2" }, DOMAINS.map(function (d) {
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
        h("div", { className: "ocRow" },
          h(Btn, { onClick: props.onBack }, "← " + t("panel.back")),
          h("span", null, "流程实例：", h("b", null, short(props.workflowId, 30))),
          h("span", { style: { flex: 1 } }),
          h(Btn, { kind: "primary", disabled: busy, onClick: function () { act(apiPost("/workflows/" + encodeURIComponent(props.workflowId) + "/instances", { context: {} }), "实例已启动"); } }, t("panel.start")),
          h(Btn, { onClick: function () { instS[1](); } }, t("panel.refresh"))),
        h(ErrLine, { error: instS[0].error }),
        h(Table, { columns: cols, rows: items }),
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
        h("div", { className: "ocH" }, "实例 #" + props.instanceId + " · " + (inst.workflow_id || "") + "@" + (inst.version || ""), h("span", { className: "ocCount" }, inst.status || "")),
        h(Btn, { onClick: props.onClose }, "✕ " + t("panel.cancel")),
        h(Table, { columns: nodeCols, rows: nodes }),
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
        h("div", { className: "ocRow" },
          h("span", null, "流程注册表：", h("b", null, String(workflows.length)), " 个版本"),
          h("span", { style: { flex: 1 } }),
          h(Btn, { onClick: function () { setShow(!show); } }, t("panel.register")),
          h(Btn, { onClick: function () { listS[1](); } }, t("panel.refresh"))),
        h(ErrLine, { error: listS[0].error }),
        h(Table, { columns: cols, rows: workflows }),
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
        h("div", { className: "ocRow" },
          h("span", null, "定时任务：", h("b", null, String(tasks.length)), " 个（cron + 时区 + 幂等执行）"),
          h("span", { style: { flex: 1 } }),
          h(Btn, { onClick: function () { listS[1](); } }, t("panel.refresh"))),
        h(ErrLine, { error: listS[0].error }),
        h(Table, { columns: cols, rows: tasks }));
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
        h("div", { className: "ocFormRow" },
          h(Field, { label: "动作过滤", value: filter.action, onChange: function (v) { setFilter(Object.assign({}, filter, { action: v })); } }),
          h(NumField, { label: "条数", value: filter.limit, onChange: function (v) { setFilter(Object.assign({}, filter, { limit: v })); } }),
          h(Btn, { onClick: function () { listS[1](); } }, t("panel.refresh"))),
        h(ErrLine, { error: listS[0].error }),
        h(Table, { columns: cols, rows: rows }),
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
        h("div", { className: "ocRow" },
          h("span", null, "冲突队列：", h("b", null, String(items.length)), " 条（冻结单元不入有效汇总，总额含冻结）"),
          h("span", { style: { flex: 1 } }),
          h(Btn, { onClick: function () { listS[1](); } }, t("panel.refresh"))),
        h(ErrLine, { error: listS[0].error }),
        h(Table, { columns: cols, rows: items }),
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
        h("div", { className: "ocRow" },
          h("span", null, "收件箱：", h("b", null, String(items.length)), " 条（高风险域只生成确认卡，不自动写库）"),
          h("span", { style: { flex: 1 } }),
          h(Btn, { onClick: function () { listS[1](); } }, t("panel.refresh"))),
        h(ErrLine, { error: listS[0].error }),
        h(Table, { columns: cols, rows: items }),
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
        h("div", { className: "ocSection" },
          h("div", { className: "ocH" }, t("panel.search")),
          h("div", { className: "ocFormRow" },
            h(Field, { label: "query", value: search.query, onChange: function (v) { setSearch(Object.assign({}, search, { query: v })); } }),
            h(Field, { label: "scopes（逗号）", value: search.scopes, onChange: function (v) { setSearch(Object.assign({}, search, { scopes: v })); } }),
            h(Field, { label: "purpose", value: search.purpose, onChange: function (v) { setSearch(Object.assign({}, search, { purpose: v })); } }),
            h(Btn, { kind: "primary", disabled: busy || !search.query, onClick: doSearch }, t("panel.search"))),
          h(ErrLine, { error: res.error }),
          h(Table, { columns: cardCols, rows: cards })),
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
        h("div", { className: "ocRow" },
          h("span", null, "插件/关键词雷达：", h("b", null, String(items.length)), " 条（只推荐不自动安装）"),
          h("span", { style: { flex: 1 } }),
          h(Btn, { onClick: function () { listS[1](); } }, t("panel.refresh"))),
        h(ErrLine, { error: listS[0].error }),
        h(Table, { columns: cols, rows: items }));
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
        h(ErrLine, { error: healthS[0].error || manifestS[0].error }),
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
          h("pre", { className: "ocMono", style: { whiteSpace: "pre-wrap", margin: 0 } }, JSON.stringify(manifest, null, 2))),
        h(Card, null,
          h("div", { className: "ocH" }, "说明"),
          h("div", { className: "ocMuted" }, "本面板是 OPC-玄机 的控制台：所有写操作经中枢视图/令牌/流程/审计统一入口，员工不直连数据库。")));
    }

    // ================= 主控制台 =================
    var TABS = [
      { id: "cockpit", label: "驾驶舱" },
      { id: "employees", label: "员工" },
      { id: "domains", label: "业务域" },
      { id: "workflows", label: "流程" },
      { id: "tasks", label: "任务" },
      { id: "audits", label: "审计" },
      { id: "conflicts", label: "冲突" },
      { id: "inbox", label: "收件箱" },
      { id: "memory", label: "记忆" },
      { id: "radar", label: "雷达" },
      { id: "settings", label: "设置" },
    ];

    function Console() {
      var tabS = react.useState("cockpit");
      var tab = tabS[0], setTab = tabS[1];
      var flashS = react.useState({ msg: "", ok: true });
      var flash = flashS[0], setFlash = flashS[1];
      var timerRef = react.useRef(null);
      function flashMsg(msg, ok) {
        setFlash({ msg: msg, ok: ok !== false });
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(function () { setFlash({ msg: "", ok: true }); }, 5000);
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
      else if (tab === "radar") body = h(RadarTab, { flash: flashMsg });
      else body = h(SettingsTab, { flash: flashMsg });

      return h("div", { className: "ocWrap" },
        h(StyleTag),
        h("div", { className: "ocHead" },
          h("div", null,
            h("div", { className: "ocTitle" }, t("panel.title")),
            h("div", { className: "ocSub" }, t("panel.sub"))),
          h("div", { className: "ocRight" },
            h(Btn, { onClick: function () { flashMsg("已刷新", true); } }, t("panel.refresh")))),
        h("div", { className: "ocTabs" },
          TABS.map(function (x) {
            return h("span", { key: x.id, className: "ocTab" + (x.id === tab ? " on" : ""), onClick: function () { setTab(x.id); } }, x.label);
          })),
        body,
        flash.msg ? h("div", { className: "ocFlash" + (flash.ok ? "" : " bad") }, flash.msg) : null);
    }

    // ---- 左栏入口图标 ----
    function SidebarIcon(props) {
      var size = typeof props.size === "number" && props.size > 0 ? props.size : 16;
      return h("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true" },
        h("path", { d: "M4 14a8 8 0 1 1 16 0" }),
        h("path", { d: "M12 14l4.2-4.2" }),
        h("circle", { cx: 12, cy: 14, r: 1.6 }),
        h("path", { d: "M4 18h16" }));
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
