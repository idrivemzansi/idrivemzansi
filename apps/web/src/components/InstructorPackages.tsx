"use client";

import { useEffect, useState } from "react";

type LessonPackage = { name: string; lesson_count: number; price: number; lesson_type?: string };

const LESSON_TYPES = ["A1", "A", "B", "EB", "C1", "C", "K53 Test Prep", "Defensive Driving"];

const formatZar = (amount: number) =>
  new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR", maximumFractionDigits: 0 }).format(amount);

export default function InstructorPackages() {
  const [rows, setRows] = useState<LessonPackage[]>([]);
  const [hourlyRate, setHourlyRate] = useState(0);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch("/api/backend/v1/instructors/me/profile")
      .then(r => r.json())
      .then(d => {
        const profile = d.item ?? {};
        setRows(Array.isArray(profile.lesson_packages) ? profile.lesson_packages : []);
        setHourlyRate(Number(profile.hourly_rate ?? 0));
        setLoaded(true);
      })
      .catch(() => {
        setMessage("Could not load your saved packages.");
        setLoaded(true);
      });
  }, []);

  function update(index: number, key: keyof LessonPackage, value: string | number) {
    setRows(current => current.map((row, i) => (i === index ? { ...row, [key]: value } : row)));
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const cleaned = rows
      .map(row => ({
        name: String(row.name ?? "").trim(),
        lesson_count: Math.round(Number(row.lesson_count)),
        price: Math.round(Number(row.price)),
        ...(String(row.lesson_type ?? "").trim() ? { lesson_type: String(row.lesson_type).trim() } : {}),
      }))
      .filter(row => row.name || row.price || row.lesson_count);

    if (cleaned.some(row => row.name.length < 2)) {
      setMessage("Give every package a name of at least 2 characters.");
      return;
    }
    if (cleaned.some(row => !(row.lesson_count >= 1))) {
      setMessage("Every package needs at least 1 lesson.");
      return;
    }
    if (cleaned.some(row => !(row.price >= 0))) {
      setMessage("Enter a package price in rands.");
      return;
    }

    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/backend/v1/instructors/me/profile", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lesson_packages: cleaned }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "Could not save your packages.");
      setRows(cleaned);
      setMessage(
        cleaned.length
          ? "Packages saved. Learners see these prices on your profile and the homepage pricing section."
          : "Packages removed. Learners will book your hourly rate.",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save your packages.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="status-card packages-editor">
      <div className="auth-eyebrow">YOUR PRICING</div>
      <h2>Lesson packages</h2>
      <p>
        You set these prices. Packages appear on your public profile and in the homepage pricing section exactly as you
        enter them — MzansiDrive never sets or adjusts them.
      </p>
      {hourlyRate > 0 && (
        <p className="packages-rate">
          Your hourly rate: <b>{formatZar(hourlyRate)}</b> per hour
        </p>
      )}

      {!loaded && <p className="instructor-muted">Loading your packages…</p>}

      <form onSubmit={save}>
        <div className="package-list">
          {!rows.length && loaded && (
            <p className="instructor-muted">
              No packages yet. Learners can still book single hours at your hourly rate.
            </p>
          )}
          {rows.map((row, index) => {
            const lessons = Math.max(1, Number(row.lesson_count) || 1);
            const price = Number(row.price) || 0;
            const perLesson = Math.round(price / lessons);
            const saving = hourlyRate > 0 ? lessons * hourlyRate - price : 0;
            return (
              <div key={index}>
                <div className="package-row">
                  <input
                    aria-label="Package name"
                    placeholder="e.g. Road Ready 10"
                    value={row.name}
                    onChange={e => update(index, "name", e.target.value)}
                  />
                  <input
                    aria-label="Lessons in package"
                    type="number"
                    min={1}
                    max={100}
                    value={row.lesson_count}
                    onChange={e => update(index, "lesson_count", Number(e.target.value))}
                  />
                  <input
                    aria-label="Package price in rand"
                    type="number"
                    min={0}
                    placeholder="R"
                    value={row.price}
                    onChange={e => update(index, "price", Number(e.target.value))}
                  />
                  <select
                    aria-label="Lesson type"
                    value={row.lesson_type ?? ""}
                    onChange={e => update(index, "lesson_type", e.target.value)}
                  >
                    <option value="">Any lesson type</option>
                    {LESSON_TYPES.map(type => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => setRows(current => current.filter((_, i) => i !== index))}
                  >
                    Remove
                  </button>
                </div>
                <p className="package-meta">
                  <span>
                    {lessons} lesson{lessons === 1 ? "" : "s"} · {formatZar(perLesson)} each
                  </span>
                  {saving > 0 && <span>Saves {formatZar(saving)} against your hourly rate</span>}
                </p>
              </div>
            );
          })}
        </div>

        <button
          type="button"
          className="package-add"
          onClick={() => setRows(current => [...current, { name: "", lesson_count: 5, price: 0, lesson_type: "" }])}
        >
          Add package
        </button>

        {message && <p role="status">{message}</p>}

        <button className="package-save" disabled={busy}>
          {busy ? "Saving…" : "Save packages"}
        </button>
      </form>
    </div>
  );
}
