const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8080";

export async function getJSON(path: string) {
  const r = await fetch(`${API_BASE}${path}`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function postJSON(path: string, body: any) {
  const r = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
