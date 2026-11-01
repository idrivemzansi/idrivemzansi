"use client";
import { useEffect, useState } from "react";

type Popup = { id: number; title: string; body: string };

async function api(path: string) {
  const r = await fetch("/api/backend" + path);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error ?? "Request failed");
  return d;
}

// On-screen popup for live notifications pushed over the realtime WebSocket.
export default function NotificationPopup() {
  const [popups, setPopups] = useState<Popup[]>([]);

  useEffect(() => {
    let ws: WebSocket | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let alive = true;
    let nextId = 0;

    const connect = async () => {
      try {
        const config = await api("/v1/realtime/config");
        if (!alive || !config.url || !config.token) return;
        ws = new WebSocket(`${config.url}${config.url.includes("?") ? "&" : "?"}token=${encodeURIComponent(config.token)}`);
        ws.onmessage = event => {
          try {
            const payload = JSON.parse(event.data);
            if (typeof payload.title !== "string" || typeof payload.body !== "string") return;
            const id = ++nextId;
            setPopups(current => [...current, { id, title: payload.title, body: payload.body }]);
            setTimeout(() => setPopups(current => current.filter(item => item.id !== id)), 8000);
          } catch {}
        };
        ws.onclose = () => { if (alive) retry = setTimeout(connect, 3000); };
      } catch {
        if (alive) retry = setTimeout(connect, 30000);
      }
    };

    connect();
    return () => {
      alive = false;
      if (retry) clearTimeout(retry);
      ws?.close();
    };
  }, []);

  if (!popups.length) return null;

  return (
    <div style={{ position: "fixed", top: 16, right: 16, zIndex: 1000, display: "flex", flexDirection: "column", gap: 10, maxWidth: 340 }}>
      {popups.map(popup => (
        <div key={popup.id} role="alert" style={{ background: "#fff", border: "1px solid #e7e7df", borderLeft: "4px solid #244b38", borderRadius: 6, boxShadow: "0 8px 24px #27382a26", padding: "12px 14px", display: "flex", gap: 10, alignItems: "flex-start" }}>
          <div style={{ flex: 1 }}>
            <strong style={{ display: "block", fontSize: 13, color: "#202c25" }}>{popup.title}</strong>
            <span style={{ display: "block", marginTop: 4, fontSize: 12, color: "#687068", lineHeight: 1.5 }}>{popup.body}</span>
          </div>
          <button aria-label="Dismiss notification" onClick={() => setPopups(current => current.filter(item => item.id !== popup.id))} style={{ border: 0, background: "none", color: "#7c827a", fontSize: 16, lineHeight: 1 }}>×</button>
        </div>
      ))}
    </div>
  );
}
