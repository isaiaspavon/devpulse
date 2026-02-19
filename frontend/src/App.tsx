import { useEffect, useMemo, useState } from "react";
import { getJSON, postJSON } from "./api";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  Filler,
} from "chart.js";
import { Line } from "react-chartjs-2";
import "./App.css";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend, Filler);

type Repo = { owner: string; name: string; default_branch: string };

function fmtWeek(d: string) {
  // backend returns timestamptz; Chart.js wants labels; keep consistent
  return new Date(d).toISOString().slice(0, 10);
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function nfmt(n: any, digits = 2) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return "—";
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return v.toFixed(digits);
}

function pct(n: any, digits = 1) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return "—";
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(digits)}%`;
}

type HeatRow = { week: string; author: string; commits: number };

function Heatmap({ rows }: { rows: HeatRow[] }) {
  // rows: [{week, author, commits}]
  const weeks = useMemo(() => {
    const set = new Set(rows.map((r) => fmtWeek(r.week)));
    return Array.from(set).sort();
  }, [rows]);

  const authors = useMemo(() => {
    const byAuthor = new Map<string, number>();
    for (const r of rows) byAuthor.set(r.author, (byAuthor.get(r.author) || 0) + Number(r.commits || 0));
    return Array.from(byAuthor.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([a]) => a)
      .slice(0, 12); // keep it readable
  }, [rows]);

  const map = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) {
      const k = `${fmtWeek(r.week)}|${r.author}`;
      m.set(k, Number(r.commits || 0));
    }
    return m;
  }, [rows]);

  const max = useMemo(() => {
    let mx = 0;
    for (const a of authors) {
      for (const w of weeks) mx = Math.max(mx, map.get(`${w}|${a}`) || 0);
    }
    return mx || 1;
  }, [authors, weeks, map]);

  if (rows.length === 0) {
    return <div className="muted">No heatmap data yet.</div>;
  }

  return (
    <div className="heatwrap">
      <div className="heathead">
        <div className="heatcorner">Author</div>
        {weeks.map((w) => (
          <div key={w} className="heatcol">{w.slice(5)}</div>
        ))}
      </div>

      {authors.map((a) => (
        <div key={a} className="heatrow">
          <div className="heatname" title={a}>{a}</div>
          {weeks.map((w) => {
            const v = map.get(`${w}|${a}`) || 0;
            const t = v / max;
            // material-ish blue scale
            const alpha = clamp(0.08 + 0.75 * t, 0.08, 0.83);
            return (
              <div
                key={`${a}|${w}`}
                className="heatcell"
                title={`${a} • ${w}: ${v} commits`}
                style={{
                  background: `rgba(26,115,232,${alpha})`,
                  borderColor: `rgba(26,115,232,${clamp(alpha + 0.08, 0.12, 0.9)})`,
                }}
              >
                {v === 0 ? "" : v}
              </div>
            );
          })}
        </div>
      ))}

      <div className="heatlegend">
        <div className="muted">Less</div>
        <div className="legendbar" />
        <div className="muted">More</div>
      </div>
    </div>
  );
}

export default function App() {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [selected, setSelected] = useState<{ owner: string; repo: string } | null>(null);

  const [rangeDays, setRangeDays] = useState<number>(30);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string>("");

  const [overview, setOverview] = useState<any | null>(null);
  const [prCycle, setPrCycle] = useState<any[]>([]);
  const [review, setReview] = useState<any[]>([]);
  const [aiRatio, setAiRatio] = useState<any[]>([]);
  const [bugDensity, setBugDensity] = useState<any[]>([]);
  const [deployments, setDeployments] = useState<any[]>([]);
  const [heat, setHeat] = useState<HeatRow[]>([]);
  const [insights, setInsights] = useState<any[]>([]);
  const [annotations, setAnnotations] = useState<any[]>([]);

  const [annoLabel, setAnnoLabel] = useState("AI tool rollout");
  const [annoDate, setAnnoDate] = useState("");
  const [annoNote, setAnnoNote] = useState("");

  useEffect(() => {
    getJSON("/api/repos")
      .then((r) => {
        setRepos(r);
        if (r?.length && !selected) setSelected({ owner: r[0].owner, repo: r[0].name });
      })
      .catch((e) => setErr(String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refresh() {
    if (!selected) return;
    setErr("");
    setLoading(true);
    const { owner, repo } = selected;

    try {
      const [
        ov,
        a,
        rv,
        b,
        c,
        d,
        hm,
        e,
        f,
      ] = await Promise.all([
        getJSON(`/api/metrics/overview?owner=${owner}&repo=${repo}&days=${rangeDays}`),
        getJSON(`/api/metrics/pr-cycle?owner=${owner}&repo=${repo}`),
        getJSON(`/api/metrics/review-turnaround?owner=${owner}&repo=${repo}`),
        getJSON(`/api/metrics/ai-ratio?owner=${owner}&repo=${repo}`),
        getJSON(`/api/metrics/bug-density?owner=${owner}&repo=${repo}`),
        getJSON(`/api/metrics/deployments?owner=${owner}&repo=${repo}`),
        getJSON(`/api/metrics/heatmap/commits?owner=${owner}&repo=${repo}&weeks=12`),
        getJSON(`/api/insights?owner=${owner}&repo=${repo}`),
        getJSON(`/api/annotations?owner=${owner}&repo=${repo}`),
      ]);

      setOverview(ov);
      setPrCycle(a);
      setReview(rv);
      setAiRatio(b);
      setBugDensity(c);
      setDeployments(d);
      setHeat(hm);
      setInsights(e);
      setAnnotations(f);
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, rangeDays]);

  async function addAnnotation() {
    if (!selected) return;
    if (!annoDate.trim() || !annoLabel.trim()) return;

    await postJSON("/api/annotations", {
      owner: selected.owner,
      repo: selected.repo,
      eventAt: new Date(annoDate).toISOString(),
      label: annoLabel,
      note: annoNote,
    });

    const refreshed = await getJSON(`/api/annotations?owner=${selected.owner}&repo=${selected.repo}`);
    setAnnotations(refreshed);
    setAnnoNote("");
  }

  const chartOpts = useMemo(() => {
    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index" as const, intersect: false },
      plugins: {
        legend: { display: true, labels: { boxWidth: 10 } },
        tooltip: { enabled: true },
      },
      scales: {
        x: { grid: { display: false } },
        y: { grid: { color: "rgba(60,64,67,0.12)" } },
      },
      elements: {
        line: { tension: 0.35, borderWidth: 2 },
        point: { radius: 0, hitRadius: 10, hoverRadius: 4 },
      },
    };
  }, []);

  const prCycleChart = useMemo(() => {
    const labels = prCycle.map((r) => fmtWeek(r.week));
    return {
      labels,
      datasets: [
        {
          label: "Avg PR cycle time (hrs)",
          data: prCycle.map((r) => r.avg_cycle_hours),
          fill: true,
          backgroundColor: "rgba(26,115,232,0.10)",
          borderColor: "rgba(26,115,232,1)",
        },
      ],
    };
  }, [prCycle]);

  const reviewChart = useMemo(() => {
    const labels = review.map((r) => fmtWeek(r.week));
    return {
      labels,
      datasets: [
        {
          label: "Avg first review time (hrs)",
          data: review.map((r) => r.avg_first_review_hours),
          fill: true,
          backgroundColor: "rgba(52,168,83,0.10)",
          borderColor: "rgba(52,168,83,1)",
        },
      ],
    };
  }, [review]);

  const aiChart = useMemo(() => {
    const labels = aiRatio.map((r) => fmtWeek(r.week));
    return {
      labels,
      datasets: [
        {
          label: "AI-assisted ratio",
          data: aiRatio.map((r) => r.ai_ratio),
          fill: true,
          backgroundColor: "rgba(251,188,5,0.18)",
          borderColor: "rgba(251,188,5,1)",
        },
      ],
    };
  }, [aiRatio]);

  const bugChart = useMemo(() => {
    const labels = bugDensity.map((r) => fmtWeek(r.week));
    return {
      labels,
      datasets: [
        {
          label: "Bugs per 100 commits",
          data: bugDensity.map((r) => r.bugs_per_100_commits),
          fill: true,
          backgroundColor: "rgba(234,67,53,0.10)",
          borderColor: "rgba(234,67,53,1)",
        },
      ],
    };
  }, [bugDensity]);

  const deployChart = useMemo(() => {
    const labels = deployments.map((r) => fmtWeek(r.week));
    return {
      labels,
      datasets: [
        {
          label: "Deployments / week",
          data: deployments.map((r) => r.deployments),
          fill: true,
          backgroundColor: "rgba(103,80,164,0.10)",
          borderColor: "rgba(103,80,164,1)",
        },
      ],
    };
  }, [deployments]);

  const repoValue = selected ? `${selected.owner}/${selected.repo}` : "";

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="logoDot" />
          <div>
            <div className="brandTitle">DevPulse</div>
            <div className="brandSub">Developer productivity intelligence</div>
          </div>
        </div>

        <div className="controls">
          <select
            className="select"
            value={repoValue}
            onChange={(e) => {
              const [owner, repo] = e.target.value.split("/");
              setSelected({ owner, repo });
            }}
          >
            {repos.map((r) => (
              <option key={`${r.owner}/${r.name}`} value={`${r.owner}/${r.name}`}>
                {r.owner}/{r.name}
              </option>
            ))}
          </select>

          <select
            className="select"
            value={String(rangeDays)}
            onChange={(e) => setRangeDays(Number(e.target.value))}
          >
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
            <option value="180">Last 180 days</option>
          </select>

          <button className="btn" onClick={refresh} disabled={loading || !selected}>
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </header>

      <main className="main">
        {err ? (
          <div className="error">
            <div className="errorTitle">Something went wrong</div>
            <div className="muted">{err}</div>
          </div>
        ) : null}

        {!selected ? (
          <div className="empty">
            <div className="emptyTitle">Select a repo to start</div>
            <div className="muted">DevPulse will show productivity metrics, trends, and annotations.</div>
          </div>
        ) : (
          <>
            {/* KPI Row */}
            <section className="kpis">
              <div className="kpi">
                <div className="kpiLabel">Avg PR cycle</div>
                <div className="kpiValue">{nfmt(overview?.avg_pr_cycle_hours, 1)} <span className="kpiUnit">hrs</span></div>
                <div className="kpiSub muted">{overview?.pr_count ?? "—"} PRs in window</div>
              </div>

              <div className="kpi">
                <div className="kpiLabel">First review</div>
                <div className="kpiValue">{nfmt(overview?.avg_first_review_hours, 1)} <span className="kpiUnit">hrs</span></div>
                <div className="kpiSub muted">Avg to first review</div>
              </div>

              <div className="kpi">
                <div className="kpiLabel">AI-assisted</div>
                <div className="kpiValue">{pct(overview?.ai_ratio, 1)}</div>
                <div className="kpiSub muted">{overview?.ai_commits ?? "—"} / {overview?.total_commits ?? "—"} commits</div>
              </div>

              <div className="kpi">
                <div className="kpiLabel">Bug density</div>
                <div className="kpiValue">{nfmt(overview?.avg_bugs_per_100_commits, 2)}</div>
                <div className="kpiSub muted">Avg bugs / 100 commits</div>
              </div>

              <div className="kpi">
                <div className="kpiLabel">Deploy velocity</div>
                <div className="kpiValue">{nfmt(overview?.deployments_per_week, 2)}</div>
                <div className="kpiSub muted">{overview?.deployments ?? "—"} deploys in window</div>
              </div>
            </section>

            <section className="grid">
              <div className="card tall">
                <div className="cardHead">
                  <div>
                    <div className="cardTitle">PR cycle time</div>
                    <div className="cardSub muted">Time from PR open → merge/close (weekly)</div>
                  </div>
                </div>
                <div className="chart">
                  <Line data={prCycleChart} options={chartOpts as any} />
                </div>
              </div>

              <div className="card tall">
                <div className="cardHead">
                  <div>
                    <div className="cardTitle">Review turnaround</div>
                    <div className="cardSub muted">Time to first submitted review (weekly)</div>
                  </div>
                </div>
                <div className="chart">
                  <Line data={reviewChart} options={chartOpts as any} />
                </div>
              </div>

              <div className="card tall">
                <div className="cardHead">
                  <div>
                    <div className="cardTitle">AI-assisted ratio</div>
                    <div className="cardSub muted">Heuristic detection from commit messages (weekly)</div>
                  </div>
                </div>
                <div className="chart">
                  <Line data={aiChart} options={chartOpts as any} />
                </div>
              </div>

              <div className="card tall">
                <div className="cardHead">
                  <div>
                    <div className="cardTitle">Bug density</div>
                    <div className="cardSub muted">Bug issues per 100 commits (weekly)</div>
                  </div>
                </div>
                <div className="chart">
                  <Line data={bugChart} options={chartOpts as any} />
                </div>
              </div>

              <div className="card tall">
                <div className="cardHead">
                  <div>
                    <div className="cardTitle">Deployment velocity</div>
                    <div className="cardSub muted">Completed workflow runs treated as deploy proxies (weekly)</div>
                  </div>
                </div>
                <div className="chart">
                  <Line data={deployChart} options={chartOpts as any} />
                </div>
              </div>

              <div className="card">
                <div className="cardHead">
                  <div>
                    <div className="cardTitle">Insights</div>
                    <div className="cardSub muted">Signals based on week-over-week changes</div>
                  </div>
                </div>
                <div className="cardBody">
                  {insights.length === 0 ? (
                    <div className="muted">No insights triggered yet.</div>
                  ) : (
                    <ul className="list">
                      {insights.map((x, i) => (
                        <li key={i} className="listItem">
                          <span className="chip">{fmtWeek(x.week)}</span>
                          <span>{x.insight}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              <div className="card wide">
                <div className="cardHead">
                  <div>
                    <div className="cardTitle">Commit activity heatmap</div>
                    <div className="cardSub muted">Top authors over the last 12 weeks</div>
                  </div>
                </div>
                <div className="cardBody">
                  <Heatmap rows={heat} />
                </div>
              </div>

              <div className="card wide">
                <div className="cardHead">
                  <div>
                    <div className="cardTitle">Annotations</div>
                    <div className="cardSub muted">Mark rollouts, team changes, or incidents</div>
                  </div>
                </div>

                <div className="cardBody">
                  <div className="annoRow">
                    <input className="input" type="date" value={annoDate} onChange={(e) => setAnnoDate(e.target.value)} />
                    <input className="input" value={annoLabel} onChange={(e) => setAnnoLabel(e.target.value)} placeholder="Label" />
                    <input className="input grow" value={annoNote} onChange={(e) => setAnnoNote(e.target.value)} placeholder="Note (optional)" />
                    <button className="btn" onClick={addAnnotation}>Add</button>
                  </div>

                  {annotations.length === 0 ? (
                    <div className="muted" style={{ marginTop: 10 }}>No annotations yet.</div>
                  ) : (
                    <ul className="list" style={{ marginTop: 10 }}>
                      {annotations
                        .slice()
                        .sort((a, b) => String(b.event_at).localeCompare(String(a.event_at)))
                        .map((a) => (
                          <li key={a.id} className="listItem">
                            <span className="chip">{fmtWeek(a.event_at)}</span>
                            <span className="annoText">
                              <b>{a.label}</b>
                              {a.note ? <span className="muted"> — {a.note}</span> : null}
                            </span>
                          </li>
                        ))}
                    </ul>
                  )}
                </div>
              </div>
            </section>
          </>
        )}
      </main>

      <footer className="footer muted">
        Built for fast exploration of developer productivity signals • {selected ? `${selected.owner}/${selected.repo}` : ""}
      </footer>
    </div>
  );
}
