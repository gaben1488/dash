import { useState, useEffect, useMemo, useRef } from "react";
import {
  ArrowLeftRight,
  ArrowRight,
  ArrowUpRight,
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  CalendarX2,
  ChartNoAxesCombined,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Circle,
  CircleAlert,
  CircleCheck,
  Coins,
  Download,
  FileCheck2,
  FileSpreadsheet,
  FileText,
  Files,
  Gavel,
  History,
  Info,
  Layers3,
  Link2,
  ListChecks,
  LoaderCircle,
  Menu,
  MessageSquare,
  MessagesSquare,
  Moon,
  Network,
  PanelsTopLeft,
  Pencil,
  Plus,
  Radar,
  Repeat2,
  RotateCcw,
  Rows3,
  ScanLine,
  Search,
  SearchX,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  StickyNote,
  Sun,
  Table2,
  X,
} from "lucide-react";
const Icons = {
  ArrowLeftRight,
  ArrowRight,
  ArrowUpRight,
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  CalendarX2,
  ChartNoAxesCombined,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Circle,
  CircleAlert,
  CircleCheck,
  Coins,
  Download,
  FileCheck2,
  FileSpreadsheet,
  FileText,
  Files,
  Gavel,
  History,
  Info,
  Layers3,
  Link2,
  ListChecks,
  LoaderCircle,
  Menu,
  MessageSquare,
  MessagesSquare,
  Moon,
  Network,
  PanelsTopLeft,
  Pencil,
  Plus,
  Radar,
  Repeat2,
  RotateCcw,
  Rows3,
  ScanLine,
  Search,
  SearchX,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  StickyNote,
  Sun,
  Table2,
  X,
};
import { NAV, DEPTS, ROWS, MONTHS, INITIAL, ISSUES } from "./data";
const Icon = ({ name, size = 17, ...p }) => {
  const C = Icons[name] || Icons.Circle;
  return <C size={size} strokeWidth={1.65} aria-hidden="true" {...p} />;
};
const fmt = (n, unit = "тыс. ₽", digits = 2) =>
  new Intl.NumberFormat("ru-RU", { maximumFractionDigits: digits }).format(
    n / (unit === "млн ₽" ? 1000 : 1),
  );
const Badge = ({ children, tone = "" }) => (
  <span className={"badge " + tone}>{children}</span>
);
const Section = ({ title, caption, action, children, className = "" }) => (
  <section className={"section " + className}>
    <div className="section-head">
      <div>
        <h2>{title}</h2>
        {caption && <p>{caption}</p>}
      </div>
      {action}
    </div>
    {children}
  </section>
);
function Seg({ label, value, options, onChange }) {
  return (
    <div className="seg-group">
      <span className="micro">{label}</span>
      <div className="seg" role="group" aria-label={label}>
        {options.map((o) => (
          <button
            key={o}
            aria-pressed={value === o}
            className={value === o ? "selected" : ""}
            onClick={() => onChange(o)}
          >
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}
function Empty({
  title = "По этому отбору закупок нет",
  text = "Измените период или снимите часть фильтров.",
  reset,
}) {
  return (
    <div className="empty">
      <Icon name="SearchX" size={32} />
      <h3>{title}</h3>
      <p>{text}</p>
      {reset && (
        <button className="btn" onClick={reset}>
          Сбросить фильтры
        </button>
      )}
    </div>
  );
}
function Metric({ label, value, sub, help, tone = "", onClick }) {
  return (
    <div className={"metric " + tone}>
      <div className="metric-label">
        {label}
        {help && (
          <span tabIndex="0" className="knowledge">
            <Icon name="Info" size={13} />
            <span role="tooltip">{help}</span>
          </span>
        )}
      </div>
      <button className="metric-number" onClick={onClick} disabled={!onClick}>
        {value}
      </button>
      <p>{sub}</p>
    </div>
  );
}
function Tabs({ value, onChange, items, label = "Раздел страницы" }) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {items.map((i) => (
        <button
          key={i}
          role="tab"
          aria-selected={i === value}
          onClick={() => onChange(i)}
        >
          {i}
        </button>
      ))}
    </div>
  );
}
function Source({ onClick }) {
  return (
    <button className="source-link" onClick={onClick}>
      <Icon name="Link2" size={13} /> Откуда число
    </button>
  );
}
function download(name, body, type = "text/plain") {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([body], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
export function App() {
  const [page, setPage] = useState("data");
  const [f, setF] = useState(INITIAL);
  const [theme, setTheme] = useState("dark");
  const [menu, setMenu] = useState(false);
  const [popover, setPopover] = useState("");
  const [row, setRow] = useState(null);
  const [rowTab, setRowTab] = useState("Обзор");
  const [toast, setToast] = useState(null);
  const [undo, setUndo] = useState(null);
  const [editing, setEditing] = useState(false);
  const [rows, setRows] = useState(ROWS);
  const [notes, setNotes] = useState({});
  const [reply, setReply] = useState("");
  const [threads, setThreads] = useState({});
  const [resolved, setResolved] = useState({});
  const [events, setEvents] = useState([
    {
      time: "16:42",
      dept: "УЭР",
      text: "Уточнено пояснение к закупке",
      state: "checked",
    },
    {
      time: "16:39",
      dept: "УО",
      text: "Изменена плановая сумма",
      state: "checked",
    },
  ]);
  const [sub, setSub] = useState({
    quality: "Замечания",
    report: "Основной",
    svod: "По управлениям",
    settings: "Источники",
    monitoring: "В работе",
    analytics: "По месяцам",
    economy: "Общая картина",
  });
  const [compact, setCompact] = useState(false);
  const [futureMode, setFutureMode] = useState(false);
  const [savedRecs, setSavedRecs] = useState([
    {
      id: "R-01",
      dept: "УО",
      text: "Проверить повторное отражение ремонта ограждения",
      status: "На рассмотрении",
    },
    {
      id: "R-02",
      dept: "УДТХ",
      text: "Подтвердить распределение стоимости между позициями плана",
      status: "В работе",
    },
  ]);
  const [newRec, setNewRec] = useState("");
  const [reportReady, setReportReady] = useState(false);
  const [reportDate, setReportDate] = useState("2026-10-10");
  const [designOpen, setDesignOpen] = useState(false);
  const [draft, setDraft] = useState(null);
  const [simulation, setSimulation] = useState("");
  const nav = NAV.find((n) => n[0] === page);
  const timer = useRef();
  const change = (k, v) => setF((prev) => ({ ...prev, [k]: v }));
  const tell = (text) => {
    setToast(text);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 5000);
  };
  const go = (id) => {
    setPage(id);
    setMenu(false);
    setPopover("");
    setRow(null);
    setEditing(false);
    window.scrollTo({ top: 0, behavior: "instant" });
  };
  useEffect(() => {
    document.title = nav[1] + " · Dash — единый макет";
  }, [page]);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") {
        setPopover("");
        setRow(null);
        setMenu(false);
        setDesignOpen(false);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        document.querySelector('[aria-label="Найти закупку"]')?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    if (!undo) return;
    const t = setTimeout(() => setUndo(null), 6000);
    return () => clearTimeout(t);
  }, [undo]);
  useEffect(() => {
    if (!row && !designOpen && !popover) return;
    const previous = document.activeElement;
    const panel = document.querySelector(
      row || designOpen ? ".detail-panel" : ".popover",
    );
    if (!panel) return;
    const all = () => [
      ...panel.querySelectorAll(
        'button:not([disabled]),input,select,textarea,[tabindex="0"]',
      ),
    ];
    all()[0]?.focus();
    const trap = (e) => {
      if (e.key !== "Tab") return;
      const nodes = all();
      const first = nodes[0],
        last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    };
    panel.addEventListener("keydown", trap);
    return () => {
      panel.removeEventListener("keydown", trap);
      previous?.focus?.();
    };
  }, [!!row, designOpen, popover]);
  const reset = () => {
    setUndo(f);
    setF({ ...INITIAL });
    setPopover("");
    setToast(null);
  };
  const filterLabels = [
    f.year !== 2026 && ["year", "Год", f.year],
    f.month && ["month", "Месяц", MONTHS[f.month - 1]],
    f.quarter && ["quarter", "Квартал", f.quarter],
    f.week && ["week", "Неделя", f.week],
    f.depts.length && ["depts", "Управления", f.depts.join(", ")],
    f.orgs.length && ["orgs", "Организации", f.orgs.join(", ")],
    f.method !== "Все" && ["method", "Способ", f.method],
    f.activity !== "Все" && ["activity", "Деятельность", f.activity],
    f.budget !== "Все" && ["budget", "Бюджет", f.budget],
    f.unit !== "тыс. ₽" && ["unit", "Единицы", f.unit],
    f.rate !== "8 %" && ["rate", "Расчёт", f.rate],
    f.query && ["query", "Поиск", f.query],
    f.stage !== "Все" && ["stage", "Стадия", f.stage],
  ].filter(Boolean);
  const scope = useMemo(
    () =>
      rows.filter(
        (r) =>
          r.year === f.year &&
          (!f.month || r.month === f.month) &&
          (!f.quarter || Math.ceil(r.month / 3) === f.quarter) &&
          (!f.week ||
            (r.month === 10 &&
              r.day >= (f.week - 40) * 7 - 1 &&
              r.day < (f.week - 39) * 7 - 1)) &&
          (!f.depts.length || f.depts.includes(r.dept)) &&
          (!f.orgs.length || f.orgs.includes(r.org)) &&
          (f.method === "Все" ||
            (f.method === "КП" ? r.method !== "ЕП" : r.method === "ЕП")) &&
          (f.activity === "Все" || r.activity === f.activity) &&
          (f.budget === "Все" || r.budget === f.budget) &&
          (!f.query ||
            [r.subject, r.seq, r.code, r.org, r.dept]
              .join(" ")
              .toLowerCase()
              .includes(f.query.toLowerCase())) &&
          (f.stage === "Все" || r.stage === f.stage),
      ),
    [rows, f],
  );
  const visible = scope.filter((r) =>
    page === "unfunded"
      ? r.stage === "Не обеспечена"
      : page === "yearlong"
        ? r.stage === "В течение года"
        : true,
  );
  const sum = (key, source = scope) =>
    source.reduce((a, r) => a + (r[key] || 0), 0);
  const plan = sum("plan"),
    fact = sum("fact"),
    economy = scope
      .filter((r) => r.economy)
      .reduce((a, r) => a + r.plan - r.fact, 0);
  const period =
    f.year +
    (f.quarter
      ? " · " + f.quarter + " квартал"
      : f.month
        ? " · " + MONTHS[f.month - 1]
        : " · весь год");
  const isFuture =
    f.year > 2026 || (f.year === 2026 && (f.month > 10 || f.week > 41));
  const openRow = (r) => {
    setRow(r);
    setRowTab("Обзор");
    setDraft({ ...r });
    setEditing(false);
  };
  const source = () => {
    setPopover("source");
  };
  const exportRows = () => {
    download(
      "dash-maket.csv",
      "\uFEFF" +
        [
          "Номер;Управление;Предмет;План, тыс. руб.;Факт, тыс. руб.;Стадия",
          ...visible.map((r) =>
            [r.seq, r.dept, r.subject, r.plan, r.fact, r.stage].join(";"),
          ),
        ].join("\n"),
      "text/csv;charset=utf-8",
    );
    tell("Выгружены строки текущего отбора");
  };
  const updateEvent = () => {
    if (simulation) return;
    setSimulation("reading");
    setEvents((e) => [
      {
        time: "Сейчас",
        dept: "УО",
        text: "Изменение замечено · читаем книгу",
        state: "pending",
      },
      ...e,
    ]);
    setTimeout(() => {
      setEvents((e) => [
        {
          time: "Сейчас",
          dept: "УО",
          text: "План уточнён · показатели пересчитаны",
          state: "checked",
        },
        ...e.slice(1),
      ]);
      setSimulation("");
      tell("Показан пример: изменение замечено → проверено");
    }, 1800);
  };
  const chartRows = DEPTS.map((dept) => ({
    dept,
    plan: sum(
      "plan",
      scope.filter((r) => r.dept === dept),
    ),
    fact: sum(
      "fact",
      scope.filter((r) => r.dept === dept),
    ),
    count: scope.filter((r) => r.dept === dept).length,
  })).filter((r) => r.count);
  const quality = ISSUES.filter(
    (i) =>
      (!f.depts.length || f.depts.includes(i.dept) || i.dept === "Все ГРБС") &&
      (i.rows.length
        ? i.rows.some((id) => scope.some((r) => r.id === id))
        : scope.length > 0),
  );
  const procedures = [
    ...new Set(scope.filter((r) => r.code).map((r) => r.code)),
  ].map((code) => ({ code, positions: scope.filter((r) => r.code === code) }));
  function Table({ data = visible, showCode = false }) {
    return data.length ? (
      <div className={"table-scroll " + (compact ? "compact" : "")}>
        <table>
          <caption>
            {period} · {data.length} позиций · суммы в {f.unit}
          </caption>
          <thead>
            <tr>
              <th>№ в плане</th>
              <th>Закупка / заказчик</th>
              <th>Управление</th>
              <th className="number">План, {f.unit}</th>
              <th className="number">Факт, {f.unit}</th>
              <th>{showCode ? "Процедура" : "Состояние"}</th>
              <th>
                <span className="sr-only">Открыть</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {data.map((r) => (
              <tr key={r.id} onClick={() => openRow(r)}>
                <td>
                  <span className={!r.seq ? "attention-text" : "mono"}>
                    {r.seq || "Не указан"}
                  </span>
                  {r.issue && (
                    <span
                      className="row-mark"
                      aria-label="Есть вопрос к данным"
                    />
                  )}
                </td>
                <td className="subject">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      openRow(r);
                    }}
                  >
                    {r.subject}
                  </button>
                  <span>{r.org}</span>
                </td>
                <td>
                  {r.dept}
                  <small>
                    {r.method} · {r.activity}
                  </small>
                </td>
                <td className="number">{fmt(r.plan, f.unit)}</td>
                <td className="number">
                  {r.fact
                    ? fmt(r.fact, f.unit)
                    : r.stage === "Завершена"
                      ? "0"
                      : "—"}
                </td>
                <td>
                  {showCode ? (
                    <span className="mono">{r.code || "Не назначена"}</span>
                  ) : (
                    <Badge
                      tone={
                        r.stage === "Завершена"
                          ? "good"
                          : r.stage === "Не обеспечена"
                            ? "attention"
                            : ""
                      }
                    >
                      {r.stage}
                    </Badge>
                  )}
                </td>
                <td>
                  <Icon name="ChevronRight" size={15} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ) : (
      <Empty reset={reset} />
    );
  }
  function ProcedureTable() {
    const shown = procedures.filter(
      (p) =>
        sub.monitoring === "Все процедуры" || p.positions.some((r) => !r.fact),
    );
    return shown.length ? (
      <div className="table-scroll">
        <table>
          <caption>
            {shown.length} основных процедур · доли раскрываются внутри
          </caption>
          <thead>
            <tr>
              <th>Процедура</th>
              <th>Предмет / связанные позиции</th>
              <th>Заказчики</th>
              <th>Стоимость</th>
              <th>Состояние</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {shown.map((p) => (
              <tr
                key={p.code}
                onClick={() => {
                  openRow(p.positions[0]);
                  setRowTab("Связи");
                }}
              >
                <td className="mono">{p.code}</td>
                <td className="subject">
                  <button>{p.positions[0].subject}</button>
                  <span>
                    {p.positions.length} поз. плана ·{" "}
                    {p.positions
                      .map((r) => "№ " + (r.seq || "не указан"))
                      .join(", ")}
                  </span>
                </td>
                <td>
                  {[...new Set(p.positions.map((r) => r.dept))].join(", ")}
                </td>
                <td>
                  {p.positions.length > 1 ? (
                    <Badge tone="attention">Уточнить доли</Badge>
                  ) : (
                    <>
                      {fmt(p.positions[0].plan, f.unit)} {f.unit}
                    </>
                  )}
                </td>
                <td>
                  <Badge>
                    {p.positions.some((r) => !r.fact)
                      ? "В работе"
                      : "Завершена"}
                  </Badge>
                </td>
                <td>
                  <Icon name="ChevronRight" size={15} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ) : (
      <Empty reset={reset} />
    );
  }
  function Stats() {
    return (
      <div className="metrics">
        <Metric
          label="План закупок"
          value={fmt(plan, f.unit)}
          sub={f.unit + " · " + period}
          onClick={source}
        />
        <Metric
          label="Заключено на сумму"
          value={isFuture ? "Ещё не наступил" : fmt(fact, f.unit)}
          sub={
            isFuture
              ? "Факт не оценивается"
              : f.unit + " · по выбранным позициям"
          }
          onClick={source}
        />
        <Metric
          label="Позиций в отборе"
          value={scope.length}
          sub={
            "из " +
            rows.filter((r) => r.year === f.year).length +
            " в примере за " +
            f.year
          }
          onClick={() => go("data")}
        />
        <Metric
          label="Подтверждённая экономия"
          value={fmt(economy, f.unit)}
          sub={f.unit + " · есть отметка «да»"}
          help="Суммируем экономию только по позициям, где её включение подтверждено. Разница между планом и фактом сама по себе не считается решением."
          onClick={source}
        />
      </div>
    );
  }
  function DeptBars({ kind = "fact" }) {
    const max = Math.max(...chartRows.map((r) => r.plan), 1);
    return (
      <div className="dept-bars">
        {chartRows.map((r) => (
          <button
            key={r.dept}
            className="bar-row"
            onClick={() => {
              change("depts", [r.dept]);
              tell("Все разделы показывают " + r.dept);
            }}
          >
            <span>{r.dept}</span>
            <div className="bar-track">
              <div
                className="bar-plan"
                style={{ width: (r.plan / max) * 100 + "%" }}
              />
              <div
                className="bar-fact"
                style={{ width: (r[kind] / max) * 100 + "%" }}
              />
            </div>
            <strong>{fmt(r[kind], f.unit)}</strong>
            <small>{r.count} поз.</small>
          </button>
        ))}
      </div>
    );
  }
  function IssueList() {
    return (
      <div className="issue-list">
        {quality.map((i) => (
          <article key={i.id}>
            <div className={"issue-symbol " + i.severity}>
              <Icon
                name={i.kind === "Правило" ? "ScanLine" : "CircleAlert"}
                size={19}
              />
            </div>
            <div className="issue-copy">
              <div>
                <Badge tone={i.kind === "Правило" ? "" : "attention"}>
                  {i.kind}
                </Badge>
                <span className="muted">
                  {i.dept} · {i.code}
                </span>
              </div>
              <h3>{i.title}</h3>
              <p>{i.text}</p>
            </div>
            <button
              className="btn small"
              onClick={() => {
                const found = rows.find((r) => r.id === i.rows[0]);
                if (found) {
                  openRow(found);
                  setRowTab(i.id === "I-06" ? "Пояснения" : "Связи");
                } else setPopover("rule");
              }}
            >
              {i.action}
              <Icon name="ArrowUpRight" size={14} />
            </button>
          </article>
        ))}
      </div>
    );
  }
  const pages = {
    data: (
      <>
        <div className="page-title">
          <div className="eyebrow">РАБОЧИЙ РЕЕСТР</div>
          <h1>Закупки</h1>
          <p>План, процедуры и исполнение — с объяснением каждой цифры.</p>
        </div>
        <div className="title-actions">
          <button className="btn" onClick={exportRows}>
            <Icon name="Download" />
            Выгрузить
          </button>
          <button
            className="btn primary"
            onClick={() => {
              openRow({
                id: "new",
                seq: "",
                dept: "УЭР",
                org: "Управление",
                subject: "",
                plan: 0,
                fact: 0,
                stage: "Запланирована",
                method: "ЕП",
                month: 10,
                year: 2026,
                activity: "ТД",
                budget: "МБ",
                day: 10,
              });
              setEditing(true);
            }}
          >
            <Icon name="Plus" />
            Добавить закупку
          </button>
        </div>
        <Stats />
        <Section
          title="Позиции плана"
          caption="Рабочий номер сохраняется рядом с карточкой закупки"
          action={
            <button
              className="icon-btn"
              aria-label="Изменить плотность таблицы"
              title="Плотность строк"
              onClick={() => setCompact(!compact)}
            >
              <Icon name="Rows3" />
            </button>
          }
        >
          <div className="table-tools">
            <div className="search-field">
              <Icon name="Search" />
              <input
                aria-label="Найти закупку"
                placeholder="Предмет, номер или организация"
                value={f.query}
                onChange={(e) => change("query", e.target.value)}
              />
              <kbd>⌘ K</kbd>
            </div>
            <select
              aria-label="Стадия закупки"
              value={f.stage}
              onChange={(e) => change("stage", e.target.value)}
            >
              {[
                "Все",
                "В работе",
                "Приём заявок",
                "Завершена",
                "Не обеспечена",
                "В течение года",
                "Запланирована",
              ].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
            <span className="result-count">{visible.length} позиций</span>
          </div>
          <Table />
        </Section>
      </>
    ),
    unfunded: (
      <>
        <div className="page-title">
          <div className="eyebrow">КОРЗИНА РЕЕСТРА</div>
          <h1>Не обеспеченные</h1>
          <p>
            Позиции, для которых ещё нужно уточнить финансирование и год плана.
          </p>
        </div>
        <div className="notice">
          <Icon name="Info" />
          <div>
            <strong>Пустой год — основание для уточнения</strong>
            <p>
              Он не доказывает отсутствие финансирования. Состояние
              подтверждается ответственным сотрудником.
            </p>
          </div>
        </div>
        <Section
          title="Требуют решения"
          caption={visible.length + " позиций в выбранном периоде"}
        >
          <Table />
        </Section>
      </>
    ),
    yearlong: (
      <>
        <div className="page-title">
          <div className="eyebrow">КОРЗИНА РЕЕСТРА</div>
          <h1>В течение года</h1>
          <p>
            Серии договоров, регулярные услуги и платежи. Отдельная рабочая
            стадия.
          </p>
        </div>
        <div className="notice">
          <Icon name="Repeat2" />
          <div>
            <strong>Отсутствие одной даты заключения здесь допустимо</strong>
            <p>
              Показываем договоры и исполнение по мере поступления сведений.
            </p>
          </div>
        </div>
        <Section
          title="Регулярные закупки"
          caption="Откройте позицию, чтобы увидеть договоры и пояснения"
        >
          <Table />
        </Section>
      </>
    ),
    svod: (
      <>
        <div className="page-title">
          <div className="eyebrow">ОБЩАЯ КАРТИНА</div>
          <h1>Свод</h1>
          <p>Один период и один отбор для всех показателей.</p>
        </div>
        <Stats />
        <Tabs
          value={sub.svod}
          items={["По управлениям", "По бюджетам", "По месяцам"]}
          onChange={(v) => setSub({ ...sub, svod: v })}
        />
        <Section
          title={sub.svod}
          caption={"Суммы в " + f.unit + " · " + period}
          action={<Source onClick={source} />}
        >
          {sub.svod === "По управлениям" ? (
            <DeptBars />
          ) : sub.svod === "По бюджетам" ? (
            <div className="budget-columns">
              {["ФБ", "КБ", "МБ"].map((b, i) => (
                <div key={b}>
                  <span className={"budget-dot b" + i} />
                  <h3>{b}</h3>
                  <strong>
                    {fmt(
                      sum(
                        "plan",
                        scope.filter((r) => r.budget === b),
                      ),
                      f.unit,
                    )}
                  </strong>
                  <p>План, {f.unit}</p>
                  <strong className="smaller">
                    {fmt(
                      sum(
                        "fact",
                        scope.filter((r) => r.budget === b),
                      ),
                      f.unit,
                    )}
                  </strong>
                  <p>Заключено, {f.unit}</p>
                </div>
              ))}
            </div>
          ) : (
            <MonthChart />
          )}
        </Section>
      </>
    ),
    monitoring: (
      <>
        <div className="page-title">
          <div className="eyebrow">ПРОЦЕДУРЫ ОПРЕДЕЛЕНИЯ ПОСТАВЩИКА</div>
          <h1>Мониторинг</h1>
          <p>Ход процедуры и вопросы к данным показаны раздельно.</p>
        </div>
        <div className="metrics three">
          <Metric
            label="Основных процедур в примере"
            value={new Set(scope.filter((r) => r.code).map((r) => r.code)).size}
            sub="Доли участников не увеличивают счётчик"
          />
          <Metric
            label="В работе"
            value={
              procedures.filter((p) => p.positions.some((r) => !r.fact)).length
            }
            sub="Процедуры с незавершёнными позициями"
          />
          <Metric
            label="Связь требует проверки"
            value={
              new Set(
                scope
                  .filter(
                    (r) =>
                      r.code &&
                      scope.filter((s) => s.code === r.code).length > 1,
                  )
                  .map((r) => r.code),
              ).size
            }
            sub="Один код у нескольких строк плана"
          />
        </div>
        <Tabs
          value={sub.monitoring}
          items={["В работе", "Все процедуры", "Вопросы к данным"]}
          onChange={(v) => setSub({ ...sub, monitoring: v })}
        />
        {sub.monitoring === "Вопросы к данным" ? (
          <Section title="Уточнить связи">
            <IssueList />
          </Section>
        ) : (
          <Section
            title={sub.monitoring}
            caption="Основная процедура раскрывается до позиций плана и долей"
          >
            <ProcedureTable />
          </Section>
        )}
      </>
    ),
    economy: (
      <>
        <div className="page-title">
          <div className="eyebrow">РЕЗУЛЬТАТ ЗАКУПОК</div>
          <h1>Экономия</h1>
          <p>Подтверждённое снижение и спорные суммы видны отдельно.</p>
        </div>
        <div className="economy-hero">
          <div>
            <div className="eyebrow">ВКЛЮЧЕНО В РАСЧЁТ</div>
            <div className="hero-number">
              {fmt(economy, f.unit)} <span>{f.unit}</span>
            </div>
            <p>{period} · только с решением учитывать</p>
            <Source onClick={source} />
          </div>
          <div className="hero-aside">
            <Icon name="CircleCheck" size={24} />
            <h3>Сохранено основание</h3>
            <p>
              Из карточки суммы можно перейти к закупке, пояснению и решению
              сотрудника.
            </p>
            <button
              className="text-btn"
              onClick={() => {
                go("quality");
                setSub((s) => ({ ...s, quality: "Замечания" }));
              }}
            >
              Разобрать спорные суммы <Icon name="ArrowRight" size={15} />
            </button>
          </div>
        </div>
        <Section
          title="Закупки с подтверждённой экономией"
          caption="Большая разница цен сама по себе не является нарушением"
        >
          <Table data={scope.filter((r) => r.economy)} />
        </Section>
      </>
    ),
    competition: (
      <>
        <div className="page-title">
          <div className="eyebrow">СПОСОБЫ И ВОЗМОЖНОСТИ</div>
          <h1>Конкуренция</h1>
          <p>
            Где применяются конкурентные процедуры и что можно рассмотреть
            вместе.
          </p>
        </div>
        <div className="metrics three">
          <Metric
            label="Конкурентные позиции"
            value={scope.filter((r) => r.method === "ЭА").length}
            sub="Способ подтверждён в плане"
          />
          <Metric
            label="Единственный поставщик"
            value={scope.filter((r) => r.method === "ЕП").length}
            sub="Сам по себе способ не означает нарушение"
          />
          <Metric
            label="Живой коэффициент снижения"
            value="9,8 %"
            sub="Иллюстрация методики · не рабочий прогноз"
            help="В рабочей версии рассчитывается по состоявшимся процедурам за скользящие 12 месяцев с указанием размера выборки."
          />
        </div>
        <div className="two-col">
          <Section
            title="Соотношение способов"
            caption="Денежная и количественная доли различаются"
          >
            <div className="method-split">
              {["ЭА", "ЕП"].map((m) => (
                <div key={m}>
                  <strong>{scope.filter((r) => r.method === m).length}</strong>
                  <h3>
                    {m === "ЭА" ? "Конкурентные" : "Единственный поставщик"}
                  </h3>
                  <p>
                    {fmt(
                      sum(
                        "plan",
                        scope.filter((r) => r.method === m),
                      ),
                      f.unit,
                    )}{" "}
                    {f.unit}
                  </p>
                </div>
              ))}
            </div>
          </Section>
          <Section
            title="Возможность объединения"
            caption="Предложение для рассмотрения"
          >
            <h3>Регулярные услуги связи</h3>
            <p className="body-copy">
              Похожие потребности разных заказчиков можно сопоставить по срокам
              и условиям. Совпадение названия ещё не означает, что их нужно
              объединять.
            </p>
            <button
              className="btn"
              onClick={() => {
                go("data");
                change("query", "связ");
              }}
            >
              Посмотреть позиции
              <Icon name="ArrowRight" />
            </button>
          </Section>
        </div>
      </>
    ),
    discipline: (
      <>
        <div className="page-title">
          <div className="eyebrow">РАБОЧИЙ СПИСОК</div>
          <h1>Дисциплина</h1>
          <p>Конкретные действия с понятным результатом.</p>
        </div>
        <div className="task-list">
          {[
            [
              "CalendarDays",
              "Уточнить год и финансирование",
              "Позиции без планового года нужно проверить с ответственными.",
              "unfunded",
              "Открыть позиции",
            ],
            [
              "Link2",
              "Разобрать повторные ссылки на процедуру",
              "Подтвердить распределение стоимости или исправить ошибочную связь.",
              "quality",
              "Перейти к сверке",
            ],
            [
              "MessageSquare",
              "Ответить на вопросы по экономии",
              "Сохранить позицию управления и принятое решение.",
              "economy",
              "Открыть экономию",
            ],
          ].map((t, i) => (
            <button key={t[0]} className="task" onClick={() => go(t[3])}>
              <span className="task-no">0{i + 1}</span>
              <Icon name={t[0]} size={24} />
              <div>
                <h3>{t[1]}</h3>
                <p>{t[2]}</p>
              </div>
              <span>
                {t[4]}
                <Icon name="ArrowRight" />
              </span>
            </button>
          ))}
        </div>
        <div className="notice quiet">
          <Icon name="CalendarCheck" />
          <p>
            Будущие сроки не превращаются в просрочку. Завершённая с опозданием
            закупка сохраняет этот факт в истории.
          </p>
        </div>
      </>
    ),
    quality: (
      <>
        <div className="page-title">
          <div className="eyebrow">ПРОВЕРКА И РЕШЕНИЕ</div>
          <h1>Контроль</h1>
          <p>Каждое замечание объясняет, что найдено и что с этим делать.</p>
        </div>
        <Tabs
          value={sub.quality}
          items={[
            "Сверка",
            "Качество заполнения",
            "Замечания",
            "Рекомендации",
            "Журнал",
          ]}
          onChange={(v) => setSub({ ...sub, quality: v })}
        />
        {sub.quality === "Журнал" ? (
          <EventPanel />
        ) : sub.quality === "Рекомендации" ? (
          Recommendations()
        ) : sub.quality === "Сверка" ? (
          <Section
            title="Что именно сравнивается"
            caption="Разница смысла не подменяется ошибкой суммы"
          >
            <div className="comparison">
              <div>
                <span>Книга управления</span>
                <h3>Плановый лимит</h3>
                <p>В тысячах рублей</p>
              </div>
              <Icon name="ArrowLeftRight" size={25} />
              <div>
                <span>Реестр процедур</span>
                <h3>Начальная цена</h3>
                <p>В рублях</p>
              </div>
            </div>
            <div className="notice">
              <Icon name="Info" />
              <p>
                Перед сравнением приводим единицы и проверяем смысл сумм. Для
                нескольких позиций одной процедуры нужны подтверждённые доли.
              </p>
            </div>
            <IssueList />
          </Section>
        ) : sub.quality === "Качество заполнения" ? (
          <Section
            title="Заполнение рабочих сведений"
            caption="Оценка по конкретным полям, без непрозрачного общего балла"
          >
            <div className="quality-grid">
              {[
                [
                  "Предмет закупки",
                  scope.filter((r) => r.subject).length,
                  scope.length,
                ],
                [
                  "Номер в плане",
                  scope.filter((r) => r.seq).length,
                  scope.length,
                ],
                [
                  "Срок и год",
                  scope.filter((r) => r.month && r.year).length,
                  scope.length,
                ],
                [
                  "Без вопросов к данным",
                  scope.filter((r) => !r.issue).length,
                  scope.length,
                ],
              ].map(([n, a, b]) => (
                <div key={n}>
                  <h3>{n}</h3>
                  <strong>
                    {a}
                    <span> / {b}</span>
                  </strong>
                  <progress value={a} max={b} />
                  <p>
                    {!b
                      ? "Нет позиций в отборе"
                      : a === b
                        ? "Проверено в текущем отборе"
                        : "Осталось уточнить: " + (b - a)}
                  </p>
                </div>
              ))}
            </div>
          </Section>
        ) : (
          <Section
            title="Требуют внимания"
            caption="Ошибка данных, вопрос к связи и ошибка правила — разные основания"
          >
            <IssueList />
          </Section>
        )}
      </>
    ),
    analytics: (
      <>
        <div className="page-title">
          <div className="eyebrow">СРАВНЕНИЯ С КОНТЕКСТОМ</div>
          <h1>Аналитика</h1>
          <p>План и исполнение во времени и по организациям.</p>
        </div>
        <Stats />
        <div className="two-col wide-left">
          <Section
            title="План и факт по месяцам"
            caption={period + " · " + f.unit}
            action={<Source onClick={source} />}
          >
            <MonthChart />
          </Section>
          <Section title="Что можно заключить">
            <div className="insight">
              <span className="eyebrow">ФАКТ</span>
              <h3>
                {scope.filter((r) => r.fact).length} позиций имеют исполнение
              </h3>
              <p>В текущем демонстрационном отборе.</p>
            </div>
            <div className="insight">
              <span className="eyebrow">СРАВНЕНИЕ</span>
              <h3>Недостаточно прошлогодних данных</h3>
              <p>Не строим сравнение по несопоставимой выборке.</p>
            </div>
            <div className="insight">
              <span className="eyebrow">ВЫВОД</span>
              <p>
                Для оценки причин нужны сведения о закупочной практике. Низкий
                процент сам по себе не означает плохую работу.
              </p>
            </div>
          </Section>
        </div>
        <Section
          title="Управления"
          caption="Нажмите на строку, чтобы применить общий отбор"
        >
          <DeptBars />
        </Section>
      </>
    ),
    report: (
      <>
        <div className="page-title">
          <div className="eyebrow">ВЫПУСК И ПРОВЕРКА</div>
          <h1>Отчёт</h1>
          <p>Состав документа виден до выгрузки.</p>
        </div>
        <Tabs
          value={sub.report}
          items={["Основной", "Дополнительный", "Оперативный", "Рекомендации"]}
          onChange={(v) => {
            setSub({ ...sub, report: v });
            setReportReady(false);
          }}
        />
        {sub.report === "Рекомендации" ? (
          Recommendations()
        ) : (
          <div className="report-layout">
            <div className="report-config">
              <h2>{sub.report} отчёт</h2>
              <p>
                {sub.report === "Оперативный"
                  ? "Краткая картина для руководителя: результат, изменения и вопросы для решения."
                  : sub.report === "Дополнительный"
                    ? "Подробный разбор рекомендаций, спорных позиций и подтверждений."
                    : "План, исполнение, экономия и состояние закупок."}
              </p>
              <label>
                Дата среза
                <input
                  type="date"
                  value={reportDate}
                  onChange={(e) => {
                    setReportDate(e.target.value);
                    setReportReady(false);
                  }}
                />
              </label>
              <div className="report-scope">
                <Icon name="SlidersHorizontal" />
                <span>
                  {period}
                  <small>
                    {f.depts.length ? f.depts.join(", ") : "Все управления"} ·{" "}
                    {f.unit}
                  </small>
                </span>
              </div>
              <button
                className="btn primary full"
                onClick={() => {
                  setReportReady(true);
                  tell("Предпросмотр собран из выбранных примеров");
                }}
              >
                <Icon name="FileCheck2" />
                Собрать предпросмотр
              </button>
              {reportReady && (
                <button
                  className="btn full"
                  onClick={() =>
                    download(
                      "dash-образец-отчёта.html",
                      `<!doctype html><meta charset="utf-8"><title>Образец отчёта</title><h1>${sub.report} отчёт — демонстрационный образец</h1><p>${period}</p><p>План: ${fmt(plan, f.unit)} ${f.unit}. Факт: ${fmt(fact, f.unit)} ${f.unit}.</p><p>Эти данные иллюстрируют макет и не являются рабочим отчётом.</p>`,
                      "text/html",
                    )
                  }
                >
                  Скачать образец
                  <Icon name="Download" />
                </button>
              )}
              <p className="tiny">
                В рабочей версии выпуск связан с проверенным снимком данных.
                Здесь — пример оформления.
              </p>
            </div>
            <div className="paper">
              <div className="paper-top">
                <span>ЕЛИЗОВСКИЙ МУНИЦИПАЛЬНЫЙ ОКРУГ</span>
                <span>
                  {reportDate
                    ? new Date(reportDate + "T12:00:00").toLocaleDateString(
                        "ru-RU",
                        { day: "numeric", month: "long", year: "numeric" },
                      )
                    : "Дата не выбрана"}
                </span>
              </div>
              <h2>
                {sub.report === "Оперативный"
                  ? "Закупки: главное к решению"
                  : sub.report === "Дополнительный"
                    ? "Рекомендации и уточнения"
                    : "Исполнение плана закупок"}
              </h2>
              <p>
                {period} · {f.depts.join(", ") || "Все управления"}
              </p>
              <div className="paper-rule" />
              <h3>01. Результат за выбранный период</h3>
              <div className="paper-numbers">
                <div>
                  <strong>{fmt(plan, f.unit)}</strong>
                  <span>План, {f.unit}</span>
                </div>
                <div>
                  <strong>{fmt(fact, f.unit)}</strong>
                  <span>Заключено, {f.unit}</span>
                </div>
              </div>
              <h3>02. Требуют решения</h3>
              <p>
                Уточнить повторные ссылки на процедуры, проверить позиции без
                номера и сохранить решения по спорной экономии.
              </p>
              <h3>03. Основание</h3>
              <p>
                Сведения из рабочих реестров и реестра процедур. Исходная
                ячейка, пояснение и история доступны в карточке закупки.
              </p>
              <div className="paper-footer">
                Демонстрационный образец · не для официального выпуска
                <span>1</span>
              </div>
              {reportReady && (
                <div className="paper-confirm">
                  <Icon name="Check" size={14} /> Предпросмотр собран
                </div>
              )}
            </div>
          </div>
        )}
      </>
    ),
    settings: (
      <>
        <div className="page-title">
          <div className="eyebrow">ОСНОВА РАБОТЫ</div>
          <h1>Система</h1>
          <p>Источники, состояние обновления и устройство данных.</p>
        </div>
        <Tabs
          value={sub.settings}
          items={["Источники", "Структура данных", "Оформление"]}
          onChange={(v) => setSub({ ...sub, settings: v })}
        />
        {sub.settings === "Источники" ? (
          <Section
            title="Рабочие источники"
            caption="Состояния ниже иллюстрируют интерфейс, подключение к книгам не выполняется"
          >
            <div className="source-list">
              {[...DEPTS, "Реестр процедур", "Свод"].map((d, i) => (
                <div key={d}>
                  <Icon name="FileSpreadsheet" />
                  <div>
                    <h3>{d}</h3>
                    <p>
                      {i < 8
                        ? "Главный рабочий лист · формулы, значения и примечания"
                        : "Рабочие и контрольные представления"}
                    </p>
                  </div>
                  <Badge tone="good">Образец состояния</Badge>
                  <button
                    className="icon-btn"
                    aria-label={"Сведения об источнике " + d}
                    onClick={source}
                  >
                    <Icon name="ArrowUpRight" />
                  </button>
                </div>
              ))}
            </div>
          </Section>
        ) : sub.settings === "Структура данных" ? (
          <Section
            title="Как связаны сведения"
            caption="Предложение целевой структуры — по смыслу работы"
          >
            <div className="structure-grid">
              {[
                ["Table2", "Закупка", "Предмет, заказчик, постоянная карточка"],
                ["Radar", "Процедуры", "Попытки проведения, участники и доли"],
                ["Files", "Договоры", "Подтверждённые договоры и исполнение"],
                [
                  "Coins",
                  "Деньги",
                  "Лимит, начальная цена, факт и перемещения",
                ],
                [
                  "MessagesSquare",
                  "Пояснения",
                  "Примечания, обсуждения и решения",
                ],
                ["History", "История", "Изменения, формулы и первоисточник"],
              ].map(([ic, n, t]) => (
                <div key={n}>
                  <Icon name={ic} size={24} />
                  <h3>{n}</h3>
                  <p>{t}</p>
                </div>
              ))}
            </div>
            <div className="notice">
              <Icon name="Link2" />
              <p>
                Одна закупка может иметь несколько процедур. Одна процедура
                может объединять несколько позиций. Связи и распределение сумм
                подтверждаются отдельно.
              </p>
            </div>
          </Section>
        ) : (
          <Section
            title="Оформление рабочего места"
            caption="Одна система поверхностей и состояний"
          >
            <div className="setting-row">
              <div>
                <h3>Тема</h3>
                <p>Тёмный графит или светлая бумага</p>
              </div>
              <Seg
                label="Тема"
                value={theme === "dark" ? "Тёмная" : "Светлая"}
                options={["Тёмная", "Светлая"]}
                onChange={(v) => setTheme(v === "Тёмная" ? "dark" : "light")}
              />
            </div>
            <div className="setting-row">
              <div>
                <h3>Плотность реестра</h3>
                <p>Полные названия сохраняются в обоих режимах</p>
              </div>
              <button className="btn" onClick={() => setCompact(!compact)}>
                {compact ? "Компактно" : "Комфортно"}
              </button>
            </div>
            <button className="btn" onClick={() => setDesignOpen(true)}>
              Решения этого макета <Icon name="ArrowUpRight" />
            </button>
          </Section>
        )}
      </>
    ),
  };
  function MonthChart() {
    const vals = MONTHS.map((m, i) => ({
      m,
      plan: sum(
        "plan",
        scope.filter((r) => r.month === i + 1),
      ),
      fact: sum(
        "fact",
        scope.filter((r) => r.month === i + 1),
      ),
    }));
    const max = Math.max(...vals.map((v) => v.plan), 1);
    return (
      <>
        <div className="chart-legend">
          <span>
            <i className="legend-plan" />
            План
          </span>
          <span>
            <i className="legend-fact" />
            Факт
          </span>
          <span>Ноябрь–декабрь: срок ещё не наступил</span>
        </div>
        <div className="month-chart">
          {vals.map((v, i) => (
            <button
              key={v.m}
              className={"chart-column " + (i > 9 ? "future" : "")}
              onClick={() => {
                setF({ ...f, month: i + 1, quarter: 0 });
                tell("Выбран " + v.m);
              }}
              title={`${v.m}: план ${fmt(v.plan, f.unit)}, факт ${fmt(v.fact, f.unit)} ${f.unit}`}
            >
              <div className="chart-plot">
                <i
                  className="plot-plan"
                  style={{
                    height:
                      Math.max((v.plan / max) * 100, v.plan ? 3 : 0) + "%",
                  }}
                />
                <i
                  className="plot-fact"
                  style={{
                    height:
                      Math.max((v.fact / max) * 100, v.fact ? 3 : 0) + "%",
                  }}
                />
                {!v.plan && <span className="no-bar">—</span>}
              </div>
              <span>{v.m}</span>
            </button>
          ))}
        </div>
        <div className="chart-foot">
          Суммы и источник доступны по нажатию на столбец. Отсутствие данных
          показано прочерком.
        </div>
      </>
    );
  }
  function Recommendations() {
    return (
      <Section
        title="Официальные рекомендации УЭР"
        caption="В этом макете изменения остаются только в текущем сеансе"
      >
        <div className="recs">
          {savedRecs
            .filter((r) => !f.depts.length || f.depts.includes(r.dept))
            .map((r) => (
              <div key={r.id}>
                <span className="mono">{r.id}</span>
                <div>
                  <strong>{r.dept}</strong>
                  <p>{r.text}</p>
                </div>
                <select
                  aria-label={"Статус рекомендации " + r.id}
                  value={r.status}
                  onChange={(e) => {
                    setSavedRecs((s) =>
                      s.map((x) =>
                        x.id === r.id ? { ...x, status: e.target.value } : x,
                      ),
                    );
                    tell("Статус изменён в макете");
                  }}
                >
                  {[
                    "На рассмотрении",
                    "В работе",
                    "Выполнена",
                    "Отклонена с обоснованием",
                  ].map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </div>
            ))}
        </div>
        <form
          className="new-rec"
          onSubmit={(e) => {
            e.preventDefault();
            if (!newRec.trim()) return;
            setSavedRecs((s) => [
              ...s,
              {
                id: "R-0" + (s.length + 1),
                dept: f.depts[0] || "УЭР",
                text: newRec,
                status: "На рассмотрении",
              },
            ]);
            setNewRec("");
            tell("Рекомендация добавлена в макет");
          }}
        >
          <label>
            Новая рекомендация
            <textarea
              placeholder="Сформулируйте действие и ожидаемый результат"
              value={newRec}
              onChange={(e) => setNewRec(e.target.value)}
            />
          </label>
          <button className="btn primary" disabled={!newRec.trim()}>
            Добавить рекомендацию
          </button>
        </form>
      </Section>
    );
  }
  function EventPanel() {
    return (
      <Section
        title="История изменений"
        caption="Новая запись появляется по событию, без прокрутки по таймеру"
      >
        <div className="event-list">
          {events.map((e, i) => (
            <div key={i}>
              <time>{e.time}</time>
              <Icon
                name={e.state === "pending" ? "LoaderCircle" : "CircleCheck"}
                size={17}
              />
              <div>
                <strong>{e.dept}</strong>
                <p>{e.text}</p>
              </div>
              <Badge tone={e.state === "pending" ? "" : "good"}>
                {e.state === "pending" ? "Проверяется" : "Проверено"}
              </Badge>
            </div>
          ))}
        </div>
        <button className="btn" disabled={!!simulation} onClick={updateEvent}>
          Показать пример обновления
        </button>
      </Section>
    );
  }
  return (
    <div
      className={"app " + theme}
      style={{ "--sky": nav[3], "--horizon": nav[4] }}
    >
      <a className="skip-link" href="#main-content">
        К содержимому
      </a>
      <aside className={"sidebar " + (menu ? "mobile-open" : "")}>
        <div className="brand">
          <div className="brand-mark">
            <Icon name="Layers3" size={23} />
          </div>
          <div>
            <strong>даш</strong>
            <span>Закупки округа</span>
          </div>
          <button
            className="icon-btn mobile-close"
            aria-label="Закрыть меню"
            onClick={() => setMenu(false)}
          >
            <Icon name="X" />
          </button>
        </div>
        <div className="sidebar-caption">РАБОЧЕЕ ПРОСТРАНСТВО</div>
        <nav aria-label="Разделы Dash">
          {NAV.map((n, i) => (
            <div key={n[0]}>
              {[4, 6, 11].includes(i) && <div className="nav-divider" />}
              <button
                data-page={n[0]}
                aria-current={page === n[0] ? "page" : undefined}
                className={
                  "nav-item " +
                  (page === n[0] ? "active" : "") +
                  (["unfunded", "yearlong"].includes(n[0]) ? " child" : "")
                }
                style={{ "--nav-sky": n[3], "--nav-horizon": n[4] }}
                onClick={() => go(n[0])}
              >
                <Icon name={n[2]} size={17} />
                <span>{n[1]}</span>
                {n[0] === "quality" && (
                  <span className="nav-count">{quality.length}</span>
                )}
              </button>
            </div>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button className="prototype-tag" onClick={() => setDesignOpen(true)}>
            <span className="live-dot" />
            Единый макет <Icon name="ArrowUpRight" size={13} />
          </button>
          <p>
            Для примерки интерфейса
            <br />
            10 октября 2026
          </p>
          <button
            className="theme-btn"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          >
            <Icon name={theme === "dark" ? "Sun" : "Moon"} size={16} />
            {theme === "dark" ? "Светлая тема" : "Тёмная тема"}
          </button>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <button
            className="icon-btn mobile-menu"
            aria-label="Открыть меню"
            onClick={() => setMenu(true)}
          >
            <Icon name="Menu" />
          </button>
          <div className="breadcrumb">
            Закупки <Icon name="ChevronRight" size={12} />
            <strong>{nav[1]}</strong>
          </div>
          <div className="topbar-right">
            <span className="demo-label">Демонстрационные данные</span>
            <button
              className="live-state"
              onClick={() => setPopover(popover === "events" ? "" : "events")}
            >
              <span className={"live-dot " + (simulation ? "pending" : "")} />
              <span>
                {simulation
                  ? "Проверяем изменение"
                  : "Снимок · 10 октября, 16:42"}
              </span>
              <Icon name="ChevronDown" size={12} />
            </button>
            <button
              className="avatar"
              aria-label="Сведения о рабочем месте"
              onClick={() => setDesignOpen(true)}
            >
              С
            </button>
          </div>
        </header>
        <div className="filter-shell">
          <div className="period-line">
            <div className="mobile-period">
              <label>
                Год
                <select
                  aria-label="Год на узком экране"
                  value={f.year}
                  onChange={(e) =>
                    setF({
                      ...f,
                      year: +e.target.value,
                      month: 0,
                      quarter: 0,
                      week: 0,
                    })
                  }
                >
                  {[2025, 2026, 2027].map((y) => (
                    <option key={y}>{y}</option>
                  ))}
                </select>
              </label>
              <label>
                Период
                <select
                  aria-label="Период на узком экране"
                  value={f.quarter ? "q" + f.quarter : String(f.month)}
                  onChange={(e) =>
                    setF({
                      ...f,
                      month: e.target.value.startsWith("q")
                        ? 0
                        : +e.target.value,
                      quarter: e.target.value.startsWith("q")
                        ? +e.target.value.slice(1)
                        : 0,
                      week: 0,
                    })
                  }
                >
                  <option value="0">Весь год</option>
                  {[1, 2, 3, 4].map((q) => (
                    <option key={"q" + q} value={"q" + q}>
                      {q} квартал
                    </option>
                  ))}
                  {MONTHS.map((m, i) => (
                    <option key={m} value={i + 1}>
                      {m}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="time-label">
              <span className="micro">ПЕРИОД</span>
              <strong>{f.year}</strong>
              <button
                onClick={() =>
                  setF({ ...f, year: 2026, month: 0, quarter: 0, week: 0 })
                }
              >
                Весь год
              </button>
            </div>
            <div className="period-drum" aria-label="Период закупок">
              {[2025, 2026, 2027].map((y, yi) => (
                <div
                  key={y}
                  className={"year-row " + (f.year === y ? "current" : "outer")}
                >
                  <button
                    className={
                      "year-button " +
                      (f.year === y && !f.month && !f.quarter ? "chosen" : "")
                    }
                    onClick={() =>
                      setF({ ...f, year: y, month: 0, quarter: 0, week: 0 })
                    }
                  >
                    {y}
                  </button>
                  <div className="quarters">
                    {[0, 1, 2, 3].map((q) => (
                      <div className="quarter" key={q}>
                        <button
                          className={
                            "quarter-label " +
                            (f.year === y && f.quarter === q + 1
                              ? "picked"
                              : "")
                          }
                          onClick={() =>
                            setF({
                              ...f,
                              year: y,
                              quarter: q + 1,
                              month: 0,
                              week: 0,
                            })
                          }
                        >
                          {["I", "II", "III", "IV"][q]}
                        </button>
                        {MONTHS.slice(q * 3, q * 3 + 3).map((m, j) => {
                          const mo = q * 3 + j + 1;
                          const has = rows.some(
                            (r) => r.year === y && r.month === mo,
                          );
                          return (
                            <button
                              key={m}
                              className={
                                "month " +
                                (y === f.year &&
                                (f.month === mo || f.quarter === q + 1)
                                  ? "chosen "
                                  : "") +
                                (!has ? "no-data " : "") +
                                (y > 2026 || (y === 2026 && mo > 10)
                                  ? "future"
                                  : "")
                              }
                              aria-pressed={f.year === y && f.month === mo}
                              title={`${m} ${y}: ${has ? (y > 2026 || (y === 2026 && mo > 10) ? "план есть, срок ещё не наступил" : "есть данные") : "данных нет"}`}
                              onClick={() =>
                                setF({
                                  ...f,
                                  year: y,
                                  month: mo,
                                  quarter: 0,
                                  week: 0,
                                })
                              }
                            >
                              {m}
                            </button>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="week-drum">
              <button
                className="week-arrow"
                aria-label="Предыдущая неделя"
                onClick={() =>
                  setF({
                    ...f,
                    year: 2026,
                    week: Math.max(1, (f.week || 41) - 1),
                    month: 0,
                    quarter: 0,
                  })
                }
              >
                <Icon name="ChevronUp" size={13} />
              </button>
              <button
                className={f.week ? "week-selected" : ""}
                onClick={() => change("week", f.week ? 0 : 41)}
              >
                <strong>{f.week || "41"}</strong>
                <span>{f.week ? "неделя выбрана" : "неделя · срез"}</span>
              </button>
              <button
                className="week-arrow"
                aria-label="Следующая неделя"
                onClick={() =>
                  setF({
                    ...f,
                    year: 2026,
                    week: Math.min(53, (f.week || 41) + 1),
                    month: 0,
                    quarter: 0,
                  })
                }
              >
                <Icon name="ChevronDown" size={13} />
              </button>
            </div>
            <button
              className={"filter-object " + (filterLabels.length ? "on" : "")}
              aria-label={"Общий отбор: " + filterLabels.length + " изменений"}
              title="Посмотреть отбор и сбросить"
              onClick={() => setPopover(popover === "filters" ? "" : "filters")}
            >
              <Icon name="SlidersHorizontal" size={20} />
              {filterLabels.length > 0 && <b>{filterLabels.length}</b>}
            </button>
          </div>
          <div className="filter-row">
            <Seg
              label="Способ"
              value={f.method}
              options={["Все", "КП", "ЕП"]}
              onChange={(v) => change("method", v)}
            />
            <Seg
              label="Деятельность"
              value={f.activity}
              options={["Все", "ПМ", "ТД"]}
              onChange={(v) => change("activity", v)}
            />
            <Seg
              label="Бюджет"
              value={f.budget}
              options={["Все", "ФБ", "КБ", "МБ"]}
              onChange={(v) => change("budget", v)}
            />
            <Seg
              label="Суммы"
              value={f.unit}
              options={["тыс. ₽", "млн ₽"]}
              onChange={(v) => change("unit", v)}
            />
            <Seg
              label="Режим расчёта"
              value={f.rate}
              options={["8 %", "Живой"]}
              onChange={(v) => {
                change("rate", v);
                tell(
                  v === "Живой"
                    ? "Живой коэффициент применяется только к оценке потенциала"
                    : "Норматив 8 % применяется только к оценке потенциала",
                );
              }}
            />
          </div>
          <div className="org-strip">
            <span className="micro">ГРБС</span>
            <button
              className={!f.depts.length ? "org active" : "org"}
              onClick={() => setF({ ...f, depts: [], orgs: [] })}
            >
              Все
            </button>
            {DEPTS.map((d) => (
              <button
                key={d}
                className={"org " + (f.depts.includes(d) ? "active" : "")}
                onClick={() =>
                  setF({
                    ...f,
                    depts: f.depts.includes(d)
                      ? f.depts.filter((x) => x !== d)
                      : [...f.depts, d],
                    orgs: [],
                  })
                }
              >
                {d}
              </button>
            ))}
            <button
              className="org-picker"
              onClick={() => setPopover(popover === "orgs" ? "" : "orgs")}
            >
              <Icon name="Network" size={14} />
              Организации{f.orgs.length ? " · " + f.orgs.length : ""}
              <Icon name="ChevronDown" size={12} />
            </button>
          </div>
          <div className="scope-line">
            <span>
              {period} · {f.depts.join(", ") || "Все управления"}
              {f.orgs.length ? " · " + f.orgs.join(", ") : ""}
            </span>
            <span>
              {f.rate === "Живой"
                ? "Потенциал: живой коэффициент"
                : "Потенциал: норматив 8 %"}
              <button
                aria-label="Основание расчёта потенциала"
                onClick={source}
              >
                <Icon name="Info" size={12} />
              </button>
            </span>
          </div>
        </div>
        <main id="main-content" className="main-content">
          {isFuture && (
            <div className="notice">
              <Icon name="CalendarClock" />
              <p>
                Выбран будущий период. План можно смотреть; оценка исполнения
                появится, когда срок наступит.
              </p>
            </div>
          )}
          {pages[page]}
        </main>
        <footer className="app-footer">
          <span>Dash · Елизовский муниципальный округ</span>
          <button onClick={() => setDesignOpen(true)}>
            О макете и принятых решениях
            <Icon name="ArrowUpRight" size={12} />
          </button>
        </footer>
      </div>
      {popover && (
        <>
          <div className="popover-backdrop" onClick={() => setPopover("")} />
          <aside
            className={
              "popover " + (["events", "orgs"].includes(popover) ? "large" : "")
            }
          >
            <div className="popover-head">
              <h2>
                {
                  {
                    filters: "Текущий отбор",
                    source: "Откуда берутся числа",
                    events: "Изменения",
                    orgs: "Организации",
                    rule: "Проверка формульного хвоста",
                  }[popover]
                }
              </h2>
              <button
                className="icon-btn"
                aria-label="Закрыть панель"
                onClick={() => setPopover("")}
              >
                <Icon name="X" />
              </button>
            </div>
            {popover === "filters" ? (
              <>
                {filterLabels.length ? (
                  <div className="filter-list">
                    {filterLabels.map(([k, n, v]) => (
                      <div key={k}>
                        <span>
                          {n}
                          <strong>{v}</strong>
                        </span>
                        <button
                          className="icon-btn"
                          aria-label={"Сбросить " + n.toLowerCase()}
                          onClick={() => change(k, INITIAL[k])}
                        >
                          <Icon name="X" size={15} />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="body-copy">
                    Весь 2026 год, все организации и способы. Используются
                    настройки по умолчанию.
                  </p>
                )}
                <button
                  className="btn full"
                  disabled={!filterLabels.length}
                  onClick={reset}
                >
                  Сбросить всё к 2026 году
                  <Icon name="RotateCcw" />
                </button>
              </>
            ) : popover === "source" ? (
              <>
                <Badge>Демонстрационный набор</Badge>
                <p className="body-copy">
                  Макет показывает 24 примера рабочих ситуаций. Значения нужны
                  для проверки интерфейса и не являются текущей отчётностью.
                </p>
                <dl className="fact-list">
                  <dt>Текущий отбор</dt>
                  <dd>{period}</dd>
                  <dt>В расчёте</dt>
                  <dd>{scope.length} позиций</dd>
                  <dt>Единицы</dt>
                  <dd>{f.unit}</dd>
                  <dt>План и факт</dt>
                  <dd>Сумма соответствующих полей выбранных позиций</dd>
                  <dt>Экономия</dt>
                  <dd>Только с подтверждением «учитывать»</dd>
                  <dt>Режим 8 % / живой</dt>
                  <dd>Меняет оценку потенциала, не фактические суммы</dd>
                </dl>
                <div className="potential">
                  Потенциал для ЕП в примере
                  <strong>
                    {fmt(
                      sum(
                        "plan",
                        scope.filter((r) => r.method === "ЕП"),
                      ) * (f.rate === "8 %" ? 0.08 : 0.098),
                      f.unit,
                    )}{" "}
                    {f.unit}
                  </strong>
                  <p>Иллюстрация, не подтверждённая экономия.</p>
                </div>
              </>
            ) : popover === "events" ? (
              <EventPanel />
            ) : popover === "orgs" ? (
              <>
                <p className="muted">
                  Управление → организация → категория. Можно выбрать
                  организации разных управлений.
                </p>
                <div className="org-tree">
                  {DEPTS.filter(
                    (d) => !f.depts.length || f.depts.includes(d),
                  ).map((d) => (
                    <details key={d} open={f.depts.includes(d)}>
                      <summary>{d}</summary>
                      {[
                        ...new Set(
                          rows.filter((r) => r.dept === d).map((r) => r.org),
                        ),
                      ].map((o) => (
                        <label key={o}>
                          <input
                            type="checkbox"
                            checked={f.orgs.includes(o)}
                            onChange={() =>
                              change(
                                "orgs",
                                f.orgs.includes(o)
                                  ? f.orgs.filter((x) => x !== o)
                                  : [...f.orgs, o],
                              )
                            }
                          />
                          {o}
                        </label>
                      ))}
                    </details>
                  ))}
                </div>
                <button
                  className="btn primary full"
                  onClick={() => setPopover("")}
                >
                  Показать выбранные
                </button>
              </>
            ) : (
              <>
                <p className="body-copy">
                  Нулевая формула в пустой заготовке строки не превращает её в
                  закупку.
                </p>
                <div className="formula-card">
                  <span>Пример пустого хвоста</span>
                  <code>=SUM(H900:J900)</code>
                  <strong>Результат: 0</strong>
                  <p>Предмет закупки отсутствует. Номер не требуется.</p>
                </div>
                <Badge tone="good">Исправлять правило, не нумерацию</Badge>
              </>
            )}
          </aside>
        </>
      )}
      {row && (
        <div className="detail-overlay">
          <div className="detail-backdrop" onClick={() => setRow(null)} />
          <aside
            className="detail-panel"
            role="dialog"
            aria-modal="true"
            aria-label="Карточка закупки"
          >
            <div className="detail-header">
              <span>КАРТОЧКА ЗАКУПКИ · {row.id}</span>
              <button
                className="icon-btn"
                aria-label="Закрыть карточку"
                onClick={() => setRow(null)}
              >
                <Icon name="X" />
              </button>
            </div>
            <div className="detail-title">
              <Badge>{row.dept}</Badge>
              <span className="muted">№ в плане {row.seq || "не указан"}</span>
              <h2>{row.subject || "Новая закупка"}</h2>
              <p>{row.org}</p>
            </div>
            <Tabs
              value={rowTab}
              items={["Обзор", "Связи", "Пояснения", "История", "Источник"]}
              onChange={(v) => {
                setRowTab(v);
                setEditing(false);
              }}
            />
            <div className="detail-body">
              {rowTab === "Обзор" ? (
                editing ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!draft.subject.trim()) return;
                      let next = {
                        ...draft,
                        id:
                          row.id === "new"
                            ? "D-" + String(rows.length + 1).padStart(3, "0")
                            : row.id,
                      };
                      setRows((s) =>
                        row.id === "new"
                          ? [...s, next]
                          : s.map((x) => (x.id === row.id ? next : x)),
                      );
                      setRow(next);
                      setEditing(false);
                      setEvents((e) => [
                        {
                          time: "Сейчас",
                          dept: next.dept,
                          text: "Изменена карточка " + next.id + " в макете",
                          state: "checked",
                        },
                        ...e,
                      ]);
                      tell("Изменения сохранены в текущем сеансе макета");
                    }}
                  >
                    <label>
                      Предмет закупки
                      <textarea
                        required
                        value={draft.subject}
                        onChange={(e) =>
                          setDraft({ ...draft, subject: e.target.value })
                        }
                      />
                    </label>
                    <div className="form-grid">
                      <label>
                        Номер в плане
                        <input
                          value={draft.seq}
                          onChange={(e) =>
                            setDraft({ ...draft, seq: e.target.value })
                          }
                        />
                      </label>
                      <label>
                        Управление
                        <select
                          value={draft.dept}
                          onChange={(e) =>
                            setDraft({ ...draft, dept: e.target.value })
                          }
                        >
                          {DEPTS.map((d) => (
                            <option key={d}>{d}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        План, тыс. ₽
                        <input
                          type="number"
                          min="0"
                          step="any"
                          value={draft.plan}
                          onChange={(e) =>
                            setDraft({ ...draft, plan: +e.target.value })
                          }
                        />
                      </label>
                      <label>
                        Факт, тыс. ₽
                        <input
                          type="number"
                          min="0"
                          step="any"
                          value={draft.fact}
                          onChange={(e) =>
                            setDraft({ ...draft, fact: +e.target.value })
                          }
                        />
                      </label>
                    </div>
                    <div className="button-row">
                      <button className="btn primary">
                        Сохранить в макете
                      </button>
                      <button
                        type="button"
                        className="btn"
                        onClick={() => setEditing(false)}
                      >
                        Отмена
                      </button>
                    </div>
                  </form>
                ) : (
                  <>
                    <div className="detail-amounts">
                      <div>
                        <span>План, тыс. ₽</span>
                        <strong>{fmt(row.plan)}</strong>
                      </div>
                      <div>
                        <span>Факт, тыс. ₽</span>
                        <strong>{row.fact ? fmt(row.fact) : "—"}</strong>
                      </div>
                    </div>
                    <dl className="fact-list">
                      <dt>Состояние</dt>
                      <dd>
                        <Badge tone={row.stage === "Завершена" ? "good" : ""}>
                          {row.stage}
                        </Badge>
                      </dd>
                      <dt>Способ</dt>
                      <dd>
                        {row.method === "ЕП"
                          ? "Единственный поставщик"
                          : "Электронный аукцион"}
                      </dd>
                      <dt>Деятельность</dt>
                      <dd>
                        {row.activity === "ПМ"
                          ? "Программное мероприятие"
                          : "Текущая деятельность"}
                      </dd>
                      <dt>Бюджет</dt>
                      <dd>{row.budget}</dd>
                      <dt>Плановый период</dt>
                      <dd>
                        {row.month
                          ? MONTHS[row.month - 1] + " " + row.year
                          : "Требует уточнения"}
                      </dd>
                      <dt>Учитывать экономию</dt>
                      <dd>
                        {row.economy
                          ? "Да"
                          : "Не подтверждено / не применяется"}
                      </dd>
                    </dl>
                    <button className="btn" onClick={() => setEditing(true)}>
                      <Icon name="Pencil" />
                      Редактировать
                    </button>
                  </>
                )
              ) : rowTab === "Связи" ? (
                <>
                  <h3>Потребность и её продолжение</h3>
                  <div className="relationship">
                    <div>
                      <Icon name="Table2" />
                      <span>
                        Позиция плана
                        <strong>
                          {row.id} · № {row.seq || "—"}
                        </strong>
                      </span>
                    </div>
                    <div>
                      <Icon name="Radar" />
                      <span>
                        Процедура
                        <strong>{row.code || "Пока не связана"}</strong>
                      </span>
                    </div>
                    <div>
                      <Icon name="Files" />
                      <span>
                        Договоры
                        <strong>
                          {row.fact
                            ? "Нужно подтвердить документом"
                            : "Сведения не поступили"}
                        </strong>
                      </span>
                    </div>
                  </div>
                  {row.code &&
                    rows.filter((x) => x.code === row.code).length > 1 && (
                      <div className="notice">
                        <Icon name="Link2" />
                        <p>
                          К этой процедуре относятся несколько строк. Нужно
                          подтвердить их связь и распределение суммы.
                        </p>
                      </div>
                    )}
                  <h3>Связанные позиции</h3>
                  {rows
                    .filter(
                      (x) => x.code && x.code === row.code && x.id !== row.id,
                    )
                    .map((x) => (
                      <button
                        key={x.id}
                        className="linked-row"
                        onClick={() => openRow(x)}
                      >
                        <span>
                          № {x.seq} · {x.subject}
                        </span>
                        <Icon name="ArrowUpRight" />
                      </button>
                    ))}
                  {!row.code && (
                    <p className="muted">
                      Связь добавляется по подтверждённому коду. Совпадения
                      предмета или цены недостаточно.
                    </p>
                  )}
                </>
              ) : rowTab === "Пояснения" ? (
                <>
                  <h3>
                    <Icon name="StickyNote" />
                    Примечание ячейки
                  </h3>
                  <p className="muted">
                    Короткое пояснение, привязанное к исходной ячейке.
                  </p>
                  <label>
                    <textarea
                      aria-label="Примечание ячейки"
                      value={
                        notes[row.id] ??
                        "Требуется сверить сведения с первичным документом."
                      }
                      onChange={(e) =>
                        setNotes({ ...notes, [row.id]: e.target.value })
                      }
                    />
                  </label>
                  <button
                    className="btn small"
                    onClick={() => tell("Примечание сохранено в макете")}
                  >
                    Сохранить примечание
                  </button>
                  <div className="detail-separator" />
                  <div className="section-head">
                    <h3>
                      <Icon name="MessagesSquare" />
                      Обсуждение
                    </h3>
                    <Badge tone={resolved[row.id] ? "good" : "attention"}>
                      {resolved[row.id] ? "Закрыто" : "Открыто"}
                    </Badge>
                  </div>
                  <div className="comment">
                    <div className="comment-avatar">У</div>
                    <div>
                      <strong>
                        Управление <time>10 октября · 16:10</time>
                      </strong>
                      <p>
                        Просим уточнить основание замечания и проверить связь с
                        процедурой.
                      </p>
                    </div>
                  </div>
                  {(threads[row.id] || []).map((t, i) => (
                    <div className="comment reply" key={i}>
                      <div className="comment-avatar">С</div>
                      <div>
                        <strong>
                          Вы <time>Сейчас · макет</time>
                        </strong>
                        <p>{t}</p>
                      </div>
                    </div>
                  ))}
                  {!resolved[row.id] && (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (!reply.trim()) return;
                        setThreads({
                          ...threads,
                          [row.id]: [...(threads[row.id] || []), reply],
                        });
                        setReply("");
                      }}
                    >
                      <textarea
                        aria-label="Ответ в обсуждении"
                        placeholder="Ответить в обсуждении"
                        value={reply}
                        onChange={(e) => setReply(e.target.value)}
                      />
                      <div className="button-row">
                        <button
                          className="btn primary"
                          disabled={!reply.trim()}
                        >
                          Ответить
                        </button>
                        <button
                          type="button"
                          className="btn"
                          onClick={() =>
                            setResolved({ ...resolved, [row.id]: true })
                          }
                        >
                          <Icon name="Check" />
                          Закрыть обсуждение
                        </button>
                      </div>
                    </form>
                  )}
                  {resolved[row.id] && (
                    <button
                      className="btn"
                      onClick={() =>
                        setResolved({ ...resolved, [row.id]: false })
                      }
                    >
                      Открыть обсуждение снова
                    </button>
                  )}
                  <p className="tiny">
                    Закрытие обсуждения не означает согласование суммы или
                    решения.
                  </p>
                </>
              ) : rowTab === "История" ? (
                <>
                  <h3>История записи</h3>
                  <div className="timeline">
                    <div>
                      <span>10 октября · 16:42</span>
                      <h3>Сведения прочитаны из источника</h3>
                      <p>Сохранены формула, результат и отображение.</p>
                    </div>
                    <div>
                      <span>10 октября · 16:10</span>
                      <h3>Добавлено обсуждение</h3>
                      <p>Вопрос к связи с процедурой остаётся открытым.</p>
                    </div>
                    <div>
                      <span>Первичная запись</span>
                      <h3>Создана карточка закупки</h3>
                      <p>
                        Её внутренний номер не зависит от перемещения строки.
                      </p>
                    </div>
                  </div>
                  <p className="tiny">
                    Пример представления истории, не журнал изменений живой
                    книги.
                  </p>
                </>
              ) : (
                <>
                  <h3>Одна ячейка — три представления</h3>
                  <div className="formula-card">
                    <span>Формула</span>
                    <code>=SUM(H4:J4)</code>
                    <span>Полный результат</span>
                    <strong className="mono">{row.plan}</strong>
                    <span>Видно в таблице</span>
                    <strong>{fmt(row.plan)} тыс. ₽</strong>
                  </div>
                  <dl className="fact-list">
                    <dt>Источник</dt>
                    <dd>Рабочая книга {row.dept}</dd>
                    <dt>Привязка</dt>
                    <dd>
                      Карточка {row.id} · номер {row.seq || "не указан"}
                    </dd>
                    <dt>Примечание</dt>
                    <dd>Сохраняется отдельно от формулы</dd>
                    <dt>Обсуждение</dt>
                    <dd>Сообщения, ответы и состояние закрытия</dd>
                  </dl>
                  <p className="tiny">
                    Адрес K4 иллюстрирует устройство карточки. В рабочей версии
                    адрес берётся из конкретной исходной записи.
                  </p>
                </>
              )}
            </div>
          </aside>
        </div>
      )}
      {designOpen && (
        <div className="detail-overlay">
          <div
            className="detail-backdrop"
            onClick={() => setDesignOpen(false)}
          />
          <aside className="detail-panel">
            <div className="detail-header">
              <span>ЕДИНЫЙ МАКЕТ · 10.10.2026</span>
              <button
                className="icon-btn"
                aria-label="Закрыть описание макета"
                onClick={() => setDesignOpen(false)}
              >
                <Icon name="X" />
              </button>
            </div>
            <div className="detail-body">
              <div className="eyebrow">ЗАРЯ · РАБОЧАЯ СРЕДА</div>
              <h1>
                Один характер.
                <br />
                Разные задачи.
              </h1>
              <p className="body-copy">
                Собраны все 12 разделов вне «Пульса». Это цельное предложение
                для примерки перед внедрением.
              </p>
              <div className="decision-list">
                {[
                  [
                    "Навигация",
                    "Названия живут в постоянном меню. Перенос и многоточия не маскируют нехватку места.",
                  ],
                  [
                    "Верхняя линейка",
                    "Период, способы, бюджеты и организации задают один контекст на весь Dash.",
                  ],
                  [
                    "Заря",
                    "Свет находится внутри выбранного элемента. У страниц свои пары, поверхности с текстом спокойные.",
                  ],
                  [
                    "Отбор",
                    "Счётчик раскрывает полный список. Сброс возвращает весь текущий год, отмена доступна 6 секунд.",
                  ],
                  [
                    "Обновления",
                    "Сначала видно, что изменение замечено; после пересчёта — подтверждено. Лента движется только по событию.",
                  ],
                  [
                    "Достоверность",
                    "Вопрос к данным, ошибка правила и рабочая стадия различаются. Неизвестное не заменяется нулём.",
                  ],
                ].map(([a, b]) => (
                  <div key={a}>
                    <h3>{a}</h3>
                    <p>{b}</p>
                  </div>
                ))}
              </div>
              <button
                className="btn"
                onClick={() => {
                  setDesignOpen(false);
                  setPopover("events");
                }}
              >
                Посмотреть поведение обновления
                <Icon name="ArrowRight" />
              </button>
              <p className="tiny">
                Макет работает на демонстрационных данных. Изменения живут в
                текущем сеансе. Подключение к рабочим книгам и внедрение в Dash
                — следующий отдельный шаг.
              </p>
            </div>
          </aside>
        </div>
      )}
      {(toast || undo) && (
        <div className="toast" role="status">
          <Icon name={undo ? "RotateCcw" : "Check"} size={17} />
          <span>{undo ? "Фильтры сброшены" : toast}</span>
          {undo && (
            <button
              onClick={() => {
                setF(undo);
                setUndo(null);
              }}
            >
              Вернуть
            </button>
          )}
          <button
            className="icon-btn"
            aria-label="Закрыть уведомление"
            onClick={() => {
              setToast(null);
              setUndo(null);
            }}
          >
            <Icon name="X" size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
