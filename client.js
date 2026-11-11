/**
 * OPC-玄机 · 一人公司中枢 —— 浏览器半（DSH Client 插件）。
 *
 * 在左栏"插件栏"注册入口「OPC驾驶舱」，主面板渲染只读驾驶舱：
 * 健康（PG/pgvector/调度/员工智能体）、范围快照指标、待归置、定时任务、雷达。
 * 数据全部来自宿主侧已注册的 /api/v1/*（src/api/http.ts），面板不写库、不派活。
 *
 * 纪律（与 dsh-super-agents 面板同一套经验）：
 *  - 只在 slots 上注册；绝不 ctx.inject 等待 client 服务（会拖坏宿主启动）；
 *  - 所有宿主 API 访问都包错，面板永不向上抛异常；
 *  - factory 无副作用；样式随组件卸载。
 */
window.__ModuleLoader__.load({
  id: "opc-xuanji",
  factory: function (require) {
    var module = { exports: {} };
    var exports = module.exports;
    var react = require("react");
    var h = react.createElement;

    var inject = ["slots", "locale"];
    var PANEL_ID = "opc-xuanji";
    var PANEL_ORDER = 27; // 超级智能体=26，雷达=30
    var API = "/api/v1";

    // ---- locale（内联词典；宿主 locale 服务可选） ----
    var localeId = "";
    var DICT = {
      zh: {
        "panel.title": "OPC驾驶舱",
        "panel.sub": "一人公司中枢 · 只读驾驶舱",
        "panel.refresh": "刷新",
        "panel.loading": "加载中…",
        "panel.ok": "健康",
        "panel.degraded": "降级",
        "panel.pg": "PostgreSQL",
        "panel.pgvector": "pgvector",
        "panel.tasks": "调度任务",
        "panel.agents": "员工智能体",
        "panel.agentsPaused": "已暂停",
        "panel.queue": "队列",
        "panel.running": "运行",
        "panel.inbox": "待归置",
        "panel.inboxEmpty": "收件箱为空",
        "panel.schedules": "定时任务",
        "panel.schedulesEmpty": "暂无任务",
        "panel.radar": "雷达",
        "panel.radarEmpty": "暂无条目",
        "panel.frozen": "冻结事件",
        "panel.frozenHint": "总额含冻结，按脚注口径",
        "panel.asOf": "快照时间",
        "panel.stale": "快照陈旧",
        "panel.next": "下次",
        "panel.last": "上次",
        "panel.enabled": "启用",
        "panel.disabled": "停用",
        "panel.range.today": "今日",
        "panel.range.7d": "7天",
        "panel.range.30d": "30天",
        "panel.range.90d": "90天",
        "panel.error": "加载失败",
      },
      en: {
        "panel.title": "OPC Cockpit",
        "panel.sub": "One-Person Company Hub · read-only cockpit",
        "panel.refresh": "Refresh",
        "panel.loading": "loading…",
        "panel.ok": "Healthy",
        "panel.degraded": "Degraded",
        "panel.pg": "PostgreSQL",
        "panel.pgvector": "pgvector",
        "panel.tasks": "Tasks",
        "panel.agents": "Employee agents",
        "panel.agentsPaused": "paused",
        "panel.queue": "queue",
        "panel.running": "running",
        "panel.inbox": "Inbox",
        "panel.inboxEmpty": "Inbox empty",
        "panel.schedules": "Schedules",
        "panel.schedulesEmpty": "No tasks",
        "panel.radar": "Radar",
        "panel.radarEmpty": "No entries",
        "panel.frozen": "Frozen events",
        "panel.frozenHint": "amounts include frozen units (see footnotes)",
        "panel.asOf": "as of",
        "panel.stale": "stale snapshot",
        "panel.next": "next",
        "panel.last": "last",
        "panel.enabled": "enabled",
        "panel.disabled": "disabled",
        "panel.range.today": "Today",
        "panel.range.7d": "7d",
        "panel.range.30d": "30d",
        "panel.range.90d": "90d",
        "panel.error": "load failed",
      },
    };
    function currentLang() {
      if (localeId) return localeId;
      try {
        return (document.documentElement.lang || "zh").split("-")[0];
      } catch (e) {
        return "zh";
      }
    }
    function t(key) {
      var d = DICT[currentLang()] || DICT.zh;
      return d[key] || DICT.en[key] || key;
    }

    // ---- API helpers：宿主 {code:0,data} 口径；任何失败都转成可读错误 ----
    function apiGet(path) {
      return fetch(API + path, { headers: { accept: "application/json" } }).then(function (res) {
        return res.json().then(function (body) {
          if (!res.ok || !body || body.code !== 0) {
            throw new Error((body && (body.message || body.errorCode)) || "HTTP " + res.status);
          }
          return body.data;
        });
      });
    }

    // ---- 格式化 ----
    function fmtNum(n) {
      if (typeof n !== "number" || !isFinite(n)) return "-";
      if (Math.abs(n) >= 10000) return (n / 10000).toFixed(1) + "万";
      return String(Math.round(n * 100) / 100);
    }
    function fmtTime(iso) {
      if (!iso) return "-";
      try {
        return new Date(iso).toLocaleString();
      } catch (e) {
        return String(iso);
      }
    }

    // ---- 样式：继承宿主字体与颜色，仅用中性 rgba，亮暗主题都可读 ----
    var CSS = [
      ".ocWrap{padding:12px;display:flex;flex-direction:column;gap:12px;font-size:13px;min-height:100%}",
      ".ocHead{display:flex;align-items:flex-start;gap:10px}",
      ".ocTitle{font-size:16px;font-weight:700;letter-spacing:.4px}",
      ".ocSub{opacity:.6;font-size:12px;margin-top:2px}",
      ".ocRight{margin-left:auto;display:flex;align-items:center;gap:8px}",
      ".ocBadge{border-radius:999px;padding:2px 10px;font-size:12px;border:1px solid rgba(128,128,128,.35)}",
      ".ocBadge.ok{color:#1a7f37;border-color:rgba(26,127,55,.45)}",
      ".ocBadge.warn{color:#b26a00;border-color:rgba(178,106,0,.5)}",
      ".ocBadge.bad{color:#b42318;border-color:rgba(180,35,24,.5)}",
      ".ocBtn{border:1px solid rgba(128,128,128,.35);border-radius:8px;background:transparent;color:inherit;font-size:12px;padding:4px 10px;cursor:pointer}",
      ".ocBtn:hover{background:rgba(128,128,128,.12)}",
      ".ocStrip{display:flex;flex-wrap:wrap;gap:8px}",
      ".ocChip{border:1px solid rgba(128,128,128,.25);border-radius:8px;padding:5px 9px;display:flex;align-items:center;gap:6px;font-size:12px}",
      ".ocDot{width:7px;height:7px;border-radius:50%;display:inline-block;flex:0 0 auto}",
      ".ocDot.ok{background:#1a7f37}.ocDot.bad{background:#b42318}.ocDot.mute{background:#8a8a8a}",
      ".ocTabs{display:flex;gap:6px}",
      ".ocTab{border:1px solid rgba(128,128,128,.3);border-radius:8px;padding:3px 10px;font-size:12px;cursor:pointer;user-select:none}",
      ".ocTab.on{background:rgba(128,128,128,.18);font-weight:600}",
      ".ocMetrics{display:flex;gap:10px;flex-wrap:wrap}",
      ".ocMetric{flex:1 1 120px;min-width:110px;border:1px solid rgba(128,128,128,.25);border-radius:10px;padding:8px}",
      ".ocMetric b{display:block;font-size:18px;line-height:1.3;font-weight:650}",
      ".ocMetric span{opacity:.6;font-size:11px}",
      ".ocCols{display:flex;gap:12px;flex-wrap:wrap}",
      ".ocCols>.ocCard{flex:1 1 280px;min-width:250px}",
      ".ocCard{border:1px solid rgba(128,128,128,.25);border-radius:10px;padding:10px;display:flex;flex-direction:column;gap:8px}",
      ".ocH{font-weight:600;font-size:13px;display:flex;align-items:center;gap:8px}",
      ".ocCount{margin-left:auto;opacity:.55;font-size:11px;font-weight:400}",
      ".ocMuted{opacity:.6;font-size:12px}",
      ".ocRow{display:flex;align-items:center;gap:8px;font-size:12px}",
      ".ocList{display:flex;flex-direction:column;gap:6px}",
      ".ocItem{font-size:12px;display:flex;gap:8px;align-items:baseline;min-width:0}",
      ".ocEllip{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1}",
      ".ocMono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;opacity:.85}",
      ".ocErr{color:#b42318;font-size:12px;border:1px solid rgba(180,35,24,.35);border-radius:8px;padding:8px}",
      ".ocEmpty{opacity:.55;font-size:12px}",
      ".ocFrozen{border:1px solid rgba(178,106,0,.4);border-radius:8px;padding:6px 10px;font-size:12px;color:#b26a00}",
      ".ocFoot{display:flex;gap:12px;flex-wrap:wrap;opacity:.55;font-size:11px;margin-top:2px}",
    ].join("\n");

    function StyleTag() {
      return h("style", null, CSS);
    }

    function Dot(props) {
      return h("span", { className: "ocDot " + (props.state || "mute") });
    }

    function Metric(props) {
      var m = props.m;
      return h(
        "div",
        { className: "ocMetric", key: m.id, title: m.source || "" },
        h("span", null, m.label),
        h("b", null, fmtNum(m.value) + (m.unit ? " " + m.unit : ""))
      );
    }

    function Cockpit() {
      var rangeS = react.useState("30d");
      var range = rangeS[0];
      var setRange = rangeS[1];
      var dataS = react.useState({
        loading: true,
        error: "",
        health: null,
        dash: null,
        inbox: [],
        tasks: [],
        radar: [],
      });
      var s = dataS[0];
      var setS = dataS[1];

      function load(r) {
        return Promise.all([
          apiGet("/health"),
          apiGet("/web/dashboard?range=" + encodeURIComponent(r)),
          apiGet("/web/inbox?limit=5").catch(function () {
            return { items: [] };
          }),
          apiGet("/tasks").catch(function () {
            return { tasks: [] };
          }),
          apiGet("/web/radar?limit=5").catch(function () {
            return { items: [] };
          }),
        ])
          .then(function (out) {
            setS({
              loading: false,
              error: "",
              health: out[0],
              dash: out[1],
              inbox: out[2].items || [],
              tasks: out[3].tasks || [],
              radar: out[4].items || [],
            });
          })
          .catch(function (err) {
            setS(function (prev) {
              return Object.assign({}, prev, {
                loading: false,
                error: String((err && err.message) || err),
              });
            });
          });
      }

      react.useEffect(
        function () {
          load(range);
          var id = setInterval(function () {
            load(range);
          }, 30000);
          return function () {
            clearInterval(id);
          };
        },
        [range]
      );

      var health = s.health || {};
      var agents = health.agents || {};
      var ok = health.status === "ok" && health.degraded !== true;
      var badge = s.loading ? "" : ok ? "ok" : "warn";
      var badgeText = s.loading ? "" : ok ? t("panel.ok") : t("panel.degraded");

      var groups = {};
      var groupOrder = [];
      if (s.dash && s.dash.metrics) {
        s.dash.metrics.forEach(function (m) {
          if (!groups[m.group]) {
            groups[m.group] = [];
            groupOrder.push(m.group);
          }
          groups[m.group].push(m);
        });
      }
      var ranges = ["today", "7d", "30d", "90d"];

      var body = h(
        "div",
        { className: "ocWrap" },
        h(StyleTag),
        // 头部
        h(
          "div",
          { className: "ocHead" },
          h(
            "div",
            null,
            h("div", { className: "ocTitle" }, t("panel.title")),
            h("div", { className: "ocSub" }, t("panel.sub"))
          ),
          h(
            "div",
            { className: "ocRight" },
            badge ? h("span", { className: "ocBadge " + badge }, badgeText) : null,
            h(
              "button",
              {
                className: "ocBtn",
                onClick: function () {
                  setS(function (prev) {
                    return Object.assign({}, prev, { loading: true, error: "" });
                  });
                  load(range);
                },
              },
              t("panel.refresh")
            )
          )
        ),
        // 健康条
        h(
          "div",
          { className: "ocStrip" },
          h("div", { className: "ocChip" }, h(Dot, { state: health.pg ? "ok" : "bad" }), t("panel.pg")),
          h(
            "div",
            { className: "ocChip" },
            h(Dot, { state: health.pgvector ? "ok" : "bad" }),
            t("panel.pgvector") + (health.pgvectorVersion ? " " + health.pgvectorVersion : "")
          ),
          h(
            "div",
            { className: "ocChip" },
            h(Dot, { state: health.scheduler ? "ok" : "mute" }),
            t("panel.tasks") + " " + ((health.scheduler && health.scheduler.enabled) || 0) + "/" + ((health.scheduler && health.scheduler.registered) || 0)
          ),
          h(
            "div",
            { className: "ocChip" },
            h(Dot, { state: agents.reachable ? (agents.paused ? "mute" : "ok") : "bad" }),
            t("panel.agents") +
              " " +
              (agents.reachable ? (agents.paused ? t("panel.agentsPaused") : t("panel.queue") + " " + (agents.queue || 0) + " · " + t("panel.running") + " " + (agents.active || 0)) : "—")
          )
        ),
        // 错误
        s.error ? h("div", { className: "ocErr" }, t("panel.error") + "：" + s.error) : null,
        // 范围
        h(
          "div",
          { className: "ocTabs" },
          ranges.map(function (r) {
            return h(
              "span",
              {
                key: r,
                className: "ocTab" + (r === range ? " on" : ""),
                onClick: function () {
                  setRange(r);
                },
              },
              t("panel.range." + r)
            );
          })
        ),
        // 指标
        s.dash
          ? groupOrder.map(function (g) {
              return h(
                "div",
                { key: g },
                h("div", { className: "ocH", style: { marginBottom: 6 } }, g),
                h("div", { className: "ocMetrics" }, groups[g].map(function (m) { return h(Metric, { key: m.id, m: m }); }))
              );
            })
          : null,
        // 冻结提示
        s.dash && s.dash.frozen && s.dash.frozen.count > 0
          ? h("div", { className: "ocFrozen" }, t("panel.frozen") + " " + s.dash.frozen.count + " · " + fmtNum(s.dash.frozen.amount) + "（" + t("panel.frozenHint") + "）")
          : null,
        // 列表区
        h(
          "div",
          { className: "ocCols" },
          h(
            "div",
            { className: "ocCard" },
            h("div", { className: "ocH" }, t("panel.inbox"), h("span", { className: "ocCount" }, s.inbox.length ? String(s.inbox.length) : "")),
            s.inbox.length
              ? h(
                  "div",
                  { className: "ocList" },
                  s.inbox.map(function (it) {
                    return h(
                      "div",
                      { className: "ocItem", key: it.id },
                      h("span", { className: "ocMono" }, "#" + it.id),
                      h("span", { className: "ocEllip", title: it.rawText || "" }, (it.rawText || "").slice(0, 60)),
                      h("span", { className: "ocMono" }, it.domain || "")
                    );
                  })
                )
              : h("div", { className: "ocEmpty" }, t("panel.inboxEmpty"))
          ),
          h(
            "div",
            { className: "ocCard" },
            h("div", { className: "ocH" }, t("panel.schedules"), h("span", { className: "ocCount" }, s.tasks.length ? String(s.tasks.length) : "")),
            s.tasks.length
              ? h(
                  "div",
                  { className: "ocList" },
                  s.tasks.slice(0, 6).map(function (task) {
                    return h(
                      "div",
                      { className: "ocItem", key: task.taskId },
                      h("span", { className: "ocDot " + (task.enabled ? "ok" : "mute") }),
                      h("span", { className: "ocEllip", title: task.name }, task.name || task.taskId),
                      h("span", { className: "ocMono" }, task.cron),
                      h("span", { className: "ocMono" }, task.nextRunAt ? t("panel.next") + " " + fmtTime(task.nextRunAt) : "")
                    );
                  })
                )
              : h("div", { className: "ocEmpty" }, t("panel.schedulesEmpty"))
          ),
          h(
            "div",
            { className: "ocCard" },
            h("div", { className: "ocH" }, t("panel.radar"), h("span", { className: "ocCount" }, s.radar.length ? String(s.radar.length) : "")),
            s.radar.length
              ? h(
                  "div",
                  { className: "ocList" },
                  s.radar.map(function (r) {
                    return h(
                      "div",
                      { className: "ocItem", key: r.id },
                      h("span", { className: "ocMono" }, r.radarType === "keyword" ? "KW" : "PL"),
                      h("span", { className: "ocEllip", title: r.title }, r.title),
                      h("span", { className: "ocMono" }, String(r.score))
                    );
                  })
                )
              : h("div", { className: "ocEmpty" }, t("panel.radarEmpty"))
          )
        ),
        // 脚注
        h(
          "div",
          { className: "ocFoot" },
          s.dash ? h("span", null, t("panel.asOf") + " " + fmtTime(s.dash.asOf)) : null,
          s.dash && s.dash.stale ? h("span", null, "⚠ " + t("panel.stale")) : null,
          s.dash && s.dash.warnings && s.dash.warnings.length ? h("span", null, s.dash.warnings.join("；")) : null
        )
      );
      return body;
    }

    // ---- 左栏入口图标：仪表盘 ----
    function SidebarIcon(props) {
      var size = typeof props.size === "number" && props.size > 0 ? props.size : 16;
      return h(
        "svg",
        {
          width: size,
          height: size,
          viewBox: "0 0 24 24",
          fill: "none",
          stroke: "currentColor",
          strokeWidth: 1.8,
          strokeLinecap: "round",
          strokeLinejoin: "round",
          "aria-hidden": "true",
        },
        h("path", { d: "M4 14a8 8 0 1 1 16 0" }),
        h("path", { d: "M12 14l4.2-4.2" }),
        h("circle", { cx: 12, cy: 14, r: 1.6 }),
        h("path", { d: "M4 18h16" })
      );
    }

    // ---- slot 声明查询（与 dsh-super-agents 同一写法） ----
    function slotDeclared(ctx, name) {
      try {
        var slots = ctx && ctx.slots;
        if (!slots) return false;
        if (typeof slots.specDynamic === "function") return !!slots.specDynamic(name);
        if (typeof slots.spec === "function") return !!slots.spec(name);
      } catch (e) {
        /* treat as undeclared */
      }
      return false;
    }

    function apply(ctx) {
      var localeSub = null;
      var applyLocale = function () {
        try {
          var snap = ctx && ctx.locale && typeof ctx.locale.getSnapshot === "function" ? ctx.locale.getSnapshot() : null;
          localeId = snap && typeof snap.active === "string" ? snap.active.split("-")[0] : "";
        } catch (e) {
          localeId = "";
        }
      };
      try {
        applyLocale();
        if (ctx && ctx.locale && typeof ctx.locale.subscribe === "function") {
          localeSub = ctx.locale.subscribe(function () {
            applyLocale();
          });
        }
      } catch (e) {
        /* locale optional */
      }

      var disposers = [];
      if (ctx && ctx.slots && typeof ctx.slots.inject === "function" && slotDeclared(ctx, "sidebar.panellist") && slotDeclared(ctx, "main")) {
        try {
          disposers.push(
            ctx.slots.inject("main", function () {
              return ctx.slots.register({ name: "main", key: PANEL_ID }, Cockpit);
            })
          );
          disposers.push(
            ctx.slots.inject("sidebar.panellist", function () {
              return ctx.slots.register(
                {
                  name: "sidebar.panellist",
                  id: PANEL_ID,
                  order: PANEL_ORDER,
                  label: function () {
                    return t("panel.title");
                  },
                },
                SidebarIcon
              );
            })
          );
        } catch (err) {
          console.warn("[opc-xuanji] panel seat failed:", err);
        }
      }
      return function () {
        for (var i = 0; i < disposers.length; i += 1) {
          try {
            disposers[i]();
          } catch (e) {
            /* ignore */
          }
        }
        if (typeof localeSub === "function") {
          try {
            localeSub();
          } catch (e) {
            /* ignore */
          }
        }
      };
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
