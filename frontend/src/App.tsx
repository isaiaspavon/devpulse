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
} from "chart.js";
import { Line } from "react-chartjs-2";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend);

type Repo = { owner: string; name: string; default_branch: string };

function fmtWeek(d: string) {
  return new Date(d).toISOString().slice(0, 10);
}

export default function App() {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [selected, setSelected] = useState<{ owner: string; repo: string } | null>(null);

  const [prCycle, setPrCycle] = useState<any[]>([]);
  const [aiRatio, setAiRatio] = useState<any[]>([]);
  const [bugDensity, setBugDensity] = useState<any[]>([]);
  const [deployments, setDeployments] = useState<any[]>([]);
  const [insights, setInsights] = useState<any[]>([]);
  const [annotations, setAnnotations] = useState<any[]>([]);

  const [annoLabel, setAnnoLabel] = useState("AI tool rollout");
  const [annoDate, setAnnoDate] = useState("");
  const [annoNote, setAnnoNote] = useState("");

  useEffect(() => {
    getJSON("/api/repos").then(setRepos);
  }, []);

  useEffect(() => {
    if (!selected) return;
    const { owner, repo } = selected;
    Promise.all([
      getJSON(`/api/metrics/pr-cycle?owner=${owner}&repo=${repo}`),
      getJSON(`/api/metrics/ai-ratio?owner=${owner}&repo=${repo}`),
      getJSON(`/api/metrics/bug-density?owner=${owner}&repo=${repo}`),
      getJSON(`/api/metrics/deployments?owner=${owner}&repo=${repo}`),
      getJSON(`/api/insights?owner=${owner}&repo=${repo}`),
      getJSON(`/api/annotations?owner=${owner}&repo=${repo}`),
    ]).then(([a, b, c, d, e, f]) => {
      setPrCycle(a);
      setAiRatio(b);
      setBugDensity(c);
      setDeployments(d);
      setInsights(e);
      setAnnotations(f);
    });
  }, [selected]);

  const prCycleChart = useMemo(() => {
    const labels = prCycle.map((r) => fmtWeek(r.week));
    return { labels, datasets: [{ label: "Avg PR cycle time (hrs)", data: prCycle.map((r) => r.avg_cycle_hours) }] };
  }, [prCycle]);

  const aiChart = useMemo(() => {
    const labels = aiRatio.map((r) => fmtWeek(r.week));
    return { labels, datasets: [{ label: "AI ratio", data: aiRatio.map((r) => r.ai_ratio) }] };
  }, [aiRatio]);

  const bugChart = useMemo(() => {
    const labels = bugDensity.map((r) => fmtWeek(r.week));
    return { labels, datasets: [{ label: "Bugs per 100 commits", data: bugDensity.map((r) => r.bugs_per_100_commits) }] };
  }, [bugDensity]);

  const deployChart = useMemo(() => {
    const labels = deployments.map((r) => fmtWeek(r.week));
    return { labels, datasets: [{ label: "Deployments / week", data: deployments.map((r) => r.deployments) }] };
  }, [deployments]);

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

  return (
    <div style={{ padding: 16, fontFamily: "system-ui" }}>
      <h2>DevPulse</h2>

      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <label>Repo:</label>
        <select
          value={selected ? `${selected.owner}/${selected.repo}` : ""}
          onChange={(e) => {
            const v = e.target.value;
            const [owner, repo] = v.split("/");
            setSelected({ owner, repo });
          }}
        >
          <option value="" disabled>Select a repo</option>
          {repos.map((r) => (
            <option key={`${r.owner}/${r.name}`} value={`${r.owner}/${r.name}`}>
              {r.owner}/{r.name}
            </option>
          ))}
        </select>
      </div>

      {!selected ? (
        <p style={{ marginTop: 16 }}>Select a repo to view metrics.</p>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 16 }}>
            <div><Line data={prCycleChart} /></div>
            <div><Line data={aiChart} /></div>
            <div><Line data={bugChart} /></div>
            <div><Line data={deployChart} /></div>
          </div>

          <div style={{ marginTop: 20 }}>
            <h3>Insights</h3>
            {insights.length === 0 ? <p>No insights triggered yet.</p> : (
              <ul>
                {insights.map((x, i) => (
                  <li key={i}><b>{fmtWeek(x.week)}:</b> {x.insight}</li>
                ))}
              </ul>
            )}
          </div>

          <div style={{ marginTop: 20 }}>
            <h3>Annotations</h3>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <input type="date" value={annoDate} onChange={(e) => setAnnoDate(e.target.value)} />
              <input value={annoLabel} onChange={(e) => setAnnoLabel(e.target.value)} placeholder="Label" />
              <input value={annoNote} onChange={(e) => setAnnoNote(e.target.value)} placeholder="Note (optional)" style={{ width: 320 }} />
              <button onClick={addAnnotation}>Add</button>
            </div>

            {annotations.length === 0 ? <p>No annotations yet.</p> : (
              <ul>
                {annotations.map((a) => (
                  <li key={a.id}><b>{fmtWeek(a.event_at)}:</b> {a.label} {a.note ? `— ${a.note}` : ""}</li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
