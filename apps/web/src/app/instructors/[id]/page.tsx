"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft, BadgeCheck, CalendarDays, CarFront, Check, Clock3, MapPin,
  MessageCircle, ShieldCheck, Sparkles, Star,
} from "lucide-react";

type AvailabilityWindow = { day: string; start: string; end: string };
type LessonPackage = { name: string; lesson_count: number; price: number; lesson_type?: string };

type Instructor = {
  user_id: string;
  full_name?: string;
  city?: string;
  suburbs_covered?: string[];
  bio?: string;
  hourly_rate?: number;
  transmission?: string;
  lesson_types?: string[];
  vehicle_make?: string;
  vehicle_model?: string;
  vehicle_photos?: string[];
  profile_photo_url?: string;
  video_intro_url?: string;
  teaching_style?: Record<string, unknown>;
  specializations?: string[];
  certifications?: string[];
  primary_approach?: string;
  philosophy?: string;
  secondary_approaches?: string[];
  student_types?: string[];
  unique_techniques?: string[];
  languages?: string[];
  experience_years?: number;
  avg_rating?: number;
  rating?: number;
  review_count?: number;
  availability_windows?: AvailabilityWindow[];
  lesson_packages?: LessonPackage[];
  own_vehicle_allowed?: boolean;
  own_vehicle_discount_percent?: number;
  membership_tier?: string;
  verification_status?: string;
};

type Review = {
  overall_rating?: number;
  punctuality?: number;
  teaching_quality?: number;
  vehicle_condition?: number;
  comments?: string;
  went_well?: string;
  improvements?: string;
  created_at?: string;
};

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const HOURS = Array.from({ length: 15 }, (_, i) => i + 6); // 06:00 – 20:00

const zar = (value: number) => `R${Number(value || 0).toLocaleString("en-ZA", { maximumFractionDigits: 0 })}`;
const label = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
const average = (rows: number[]) => (rows.length ? rows.reduce((total, n) => total + n, 0) / rows.length : 0);
const hourOf = (time: string) => Number(String(time ?? "").split(":")[0] ?? 0);

export default function InstructorProfilePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = String(params?.id ?? "");

  const [instructor, setInstructor] = useState<Instructor | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<"" | "missing" | "error">("");
  const [attempt, setAttempt] = useState(0);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    setFailure("");
    fetch(`/api/backend/v1/instructors/${encodeURIComponent(id)}`)
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          if (!cancelled) setFailure(response.status === 404 ? "missing" : "error");
          return;
        }
        if (!cancelled) setInstructor(body.item ?? null);
      })
      .catch(() => {
        if (!cancelled) setFailure("error");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    fetch(`/api/backend/v1/instructors/${encodeURIComponent(id)}/reviews`)
      .then((response) => (response.ok ? response.json() : { items: [] }))
      .then((body) => {
        if (!cancelled) setReviews(Array.isArray(body.items) ? body.items : []);
      })
      .catch(() => {
        if (!cancelled) setReviews([]);
      });      return () => {
      cancelled = true;
    };
  }, [id, attempt]);

  const computed = useMemo(() => {
    const rated = reviews.filter((review) => Number(review.overall_rating) > 0);
    const overall = average(rated.map((review) => Number(review.overall_rating)));
    const histogram = [5, 4, 3, 2, 1].map((star) => ({
      star,
      count: rated.filter((review) => Math.round(Number(review.overall_rating)) === star).length,
    }));
    const share = (field: keyof Review) => {
      const rows = reviews.filter((review) => Number(review[field]) > 0);
      return { value: average(rows.map((review) => Number(review[field]))), count: rows.length };
    };
    const recommend = rated.length
      ? Math.round((rated.filter((review) => Number(review.overall_rating) >= 4).length / rated.length) * 100)
      : 0;
    return {
      overall: overall || Number(instructor?.avg_rating ?? instructor?.rating ?? 0),
      count: rated.length || Number(instructor?.review_count ?? 0),
      histogram,
      punctuality: share("punctuality"),
      teaching: share("teaching_quality"),
      vehicle: share("vehicle_condition"),
      recommend,
      stars: rated.length,
    };
  }, [reviews, instructor]);

  const ownVehicleRate = useMemo(() => {
    const rate = Number(instructor?.hourly_rate ?? 0);
    const discount = Number(instructor?.own_vehicle_discount_percent ?? 0);
    return instructor?.own_vehicle_allowed && discount > 0 ? Math.round(rate * (1 - discount / 100)) : 0;
  }, [instructor]);

  const packages = useMemo(() => {
    const listed = instructor?.lesson_packages ?? [];
    if (listed.length) return listed;
    const rate = Number(instructor?.hourly_rate ?? 0);
    return rate > 0 ? [{ name: "Single lesson", lesson_count: 1, price: rate }] : [];
  }, [instructor]);

  const share = async () => {
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title: instructor?.full_name ?? "MzansiDrive instructor", url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setNotice("Profile link copied.");
    } catch {
      setNotice("Could not share this profile.");
    }
    setTimeout(() => setNotice(""), 3000);
  };

  if (loading) {
    return (
      <main className="ip-page">
        <SiteHeader />
        <div className="ip-loading">Loading instructor profile…</div>
      </main>
    );
  }

  if (failure === "error") {
    return (
      <main className="ip-page">
        <SiteHeader />
        <div className="ip-empty">
          <span className="ip-empty-icon"><ShieldCheck size={26} /></span>
          <h1>We could not load this profile</h1>
          <p>The instructor service did not respond. Please try again.</p>
          <button className="dark-button" onClick={() => setAttempt((n) => n + 1)}>Try again</button>
        </div>
      </main>
    );
  }

  if (failure === "missing" || !instructor) {
    return (
      <main className="ip-page">
        <SiteHeader />
        <div className="ip-empty">
          <span className="ip-empty-icon"><ShieldCheck size={26} /></span>
          <h1>Instructor not found</h1>
          <p>This instructor is unavailable or has not been verified yet.</p>
          <a className="dark-button" href="/#explore">Back to instructors</a>
        </div>
      </main>
    );
  }

  const name = instructor.full_name ?? "Your instructor";
  const initials = name.split(" ").map((part) => part.charAt(0)).slice(0, 2).join("").toUpperCase();
  const cover = instructor.vehicle_photos?.[0] ?? "";
  const areas = instructor.suburbs_covered ?? [];
  const premier = String(instructor.membership_tier ?? "").toLowerCase() === "premier";

  const book = () => router.push(`/learner/book?instructorId=${encodeURIComponent(instructor.user_id)}`);

  return (
    <main className="ip-page">
      <SiteHeader />

      <div className="ip-main">
        <a className="ip-back" href="/#explore"><ArrowLeft size={14} /> Back to instructors</a>

        <section className="ip-hero">
          <div className="ip-cover" style={cover ? { backgroundImage: `url(${cover})` } : undefined} />
          <div className="ip-hero-body">
            <div className="ip-avatar">
              {instructor.profile_photo_url
                ? <img src={instructor.profile_photo_url} alt={name} />
                : <span>{initials}</span>}
            </div>
            <div className="ip-id">
              <div className="ip-idtop">
                <div className="ip-idcopy">
                  <div className="ip-name-row">
                    <h1>{name}</h1>
                    {instructor.verification_status === "active" && (
                      <span className="ip-badge verified"><BadgeCheck size={12} /> VERIFIED PRO</span>
                    )}
                    {premier && <span className="ip-badge premier"><Sparkles size={12} /> PREMIER</span>}
                  </div>
                  <div className="ip-meta">
                    <span><MapPin size={13} /> {areas.length ? areas.join(", ") : instructor.city ?? "South Africa"}</span>
                    <span><Clock3 size={13} /> {Number(instructor.experience_years ?? 0)} years teaching</span>
                  </div>
                  <div className="ip-score">
                    <Star size={15} fill="currentColor" />
                    <b>{computed.overall.toFixed(1)}</b>
                    <span>({computed.count} review{computed.count === 1 ? "" : "s"})</span>
                  </div>
                </div>
                <div className="ip-rate">
                  <span>Starting from</span>
                  <b>{zar(Number(instructor.hourly_rate ?? 0))}</b>
                  <small>per hour</small>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="ip-stats">
          <div className="ip-stat"><small>EXPERIENCE</small><b>{Number(instructor.experience_years ?? 0)} years</b></div>
          <div className="ip-stat"><small>LANGUAGES</small><b>{instructor.languages?.length ?? 0}</b></div>
          <div className="ip-stat"><small>LESSON TYPES</small><b>{instructor.lesson_types?.length ?? 0}</b></div>
          <div className="ip-stat"><small>SERVICE AREAS</small><b>{areas.length || instructor.city || "—"}</b></div>
        </section>

        <div className="ip-layout">
          <div className="ip-content">
            <section className="ip-section">
              <div className="auth-eyebrow">ABOUT</div>
              <h2>About {name.split(" ")[0]}</h2>
              <p className="ip-lede">
                {instructor.bio || "A local driving instructor ready to help you build confidence on the road."}
              </p>

              {!!instructor.specializations?.length && (
                <>
                  <h3>Specialisations</h3>
                  <div className="ip-tags">{instructor.specializations.map((item) => <span key={item}>{item}</span>)}</div>
                </>
              )}

              <div className="ip-facts">
                {instructor.primary_approach && <div><small>PRIMARY APPROACH</small><b>{instructor.primary_approach}</b></div>}
                {instructor.philosophy && <div><small>TEACHING PHILOSOPHY</small><b>{instructor.philosophy}</b></div>}
                {!!instructor.languages?.length && <div><small>LANGUAGES</small><b>{instructor.languages.join(", ")}</b></div>}
                {instructor.transmission && <div><small>TRANSMISSION</small><b>{label(instructor.transmission)}</b></div>}
              </div>

              {!!instructor.secondary_approaches?.length && (
                <>
                  <h3>Teaching methods</h3>
                  <div className="ip-tags">{instructor.secondary_approaches.map((item) => <span key={item}>{item}</span>)}</div>
                </>
              )}

              {!!instructor.student_types?.length && (
                <>
                  <h3>Works best with</h3>
                  <div className="ip-tags">{instructor.student_types.map((item) => <span key={item}>{item}</span>)}</div>
                </>
              )}

              {!!instructor.unique_techniques?.length && (
                <>
                  <h3>Techniques</h3>
                  <div className="ip-tags">{instructor.unique_techniques.map((item) => <span key={item}>{item}</span>)}</div>
                </>
              )}

              {!!instructor.certifications?.length && (
                <>
                  <h3>Certifications</h3>
                  <div className="ip-tags">{instructor.certifications.map((item) => <span key={item}>{item}</span>)}</div>
                </>
              )}
            </section>

            <section className="ip-section">
              <div className="auth-eyebrow">VEHICLE & LESSONS</div>
              <h2>What you&apos;ll learn in</h2>
              {!!instructor.vehicle_photos?.length && (
                <div className="ip-gallery">
                  {instructor.vehicle_photos.map((photo, index) => (
                    <img key={`${photo}-${index}`} src={photo} alt={`${name} teaching vehicle ${index + 1}`} loading="lazy" />
                  ))}
                </div>
              )}
              <div className="ip-facts">
                <div><small>VEHICLE</small><b><CarFront size={13} /> {instructor.vehicle_make ?? ""} {instructor.vehicle_model ?? ""}</b></div>
                <div><small>TRANSMISSION</small><b>{label(instructor.transmission ?? "manual")}</b></div>
                <div><small>SERVICE AREA</small><b>{areas.length ? `${areas.length} suburb${areas.length === 1 ? "" : "s"}` : instructor.city ?? "South Africa"}</b></div>
              </div>
              {!!instructor.lesson_types?.length && (
                <div className="ip-tags">{instructor.lesson_types.map((item) => <span key={item}>{item}</span>)}</div>
              )}
              {instructor.video_intro_url && (
                <>
                  <h3>Meet {name.split(" ")[0]}</h3>
                  <video className="ip-video" controls src={instructor.video_intro_url} />
                </>
              )}
            </section>

            <section className="ip-section">
              <div className="auth-eyebrow">LESSON PACKAGES</div>
              <h2>Save with a package</h2>
              <p className="ip-lede">Book a bundle instead of single lessons. Packages stay valid for 90 days from purchase.</p>
              <div className="ip-packages">
                {packages.map((pkg) => {
                  const listValue = Number(instructor.hourly_rate ?? 0) * Number(pkg.lesson_count);
                  const saving = listValue - Number(pkg.price);
                  return (
                    <article className="ip-package" key={pkg.name}>
                      {saving > 0 && <span className="ip-save">SAVE {zar(saving)}</span>}
                      <b>{pkg.name}</b>
                      <span className="ip-price">{zar(Number(pkg.price))}</span>
                      <small>
                        {Number(pkg.lesson_count)} lesson{Number(pkg.lesson_count) === 1 ? "" : "s"}
                        {Number(pkg.lesson_count) > 1 && ` · ${zar(Number(pkg.price) / Number(pkg.lesson_count))} each`}
                      </small>
                      {pkg.lesson_type && <small>{pkg.lesson_type}</small>}
                      <button className="ip-package-book" onClick={book}>Select this package</button>
                    </article>
                  );
                })}
              </div>
            </section>

            <section className="ip-section">
              <div className="auth-eyebrow">REVIEWS</div>
              <h2>What learners say</h2>
              <div className="ip-review-score">
                <div className="ip-overall">
                  <span className="ip-big-score">{computed.overall.toFixed(1)}</span>
                  <div className="ip-stars">
                    {"★★★★★".slice(0, Math.round(computed.overall))}
                    <span className="ip-stars-off">{"★★★★★".slice(Math.round(computed.overall))}</span>
                  </div>
                  <small>Based on {computed.count} review{computed.count === 1 ? "" : "s"}</small>
                </div>
                <div className="ip-hist">
                  {computed.histogram.map((row) => (
                    <div className="ip-hist-row" key={row.star}>
                      <span>{row.star} ★</span>
                      <span className="ip-bar">
                        <i style={{ width: `${computed.count ? (row.count / computed.count) * 100 : 0}%` }} />
                      </span>
                      <span>{row.count}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="ip-breakdown">
                <div>
                  <small>PUNCTUALITY</small>
                  <span className="ip-bar"><i style={{ width: `${(computed.punctuality.value / 5) * 100}%` }} /></span>
                  <b>{computed.punctuality.value ? `${computed.punctuality.value.toFixed(1)} / 5` : "—"}</b>
                </div>
                <div>
                  <small>TEACHING QUALITY</small>
                  <span className="ip-bar"><i style={{ width: `${(computed.teaching.value / 5) * 100}%` }} /></span>
                  <b>{computed.teaching.value ? `${computed.teaching.value.toFixed(1)} / 5` : "—"}</b>
                </div>
                <div>
                  <small>VEHICLE CONDITION</small>
                  <span className="ip-bar"><i style={{ width: `${(computed.vehicle.value / 5) * 100}%` }} /></span>
                  <b>{computed.vehicle.value ? `${computed.vehicle.value.toFixed(1)} / 5` : "—"}</b>
                </div>
                <div>
                  <small>WOULD RECOMMEND</small>
                  <span className="ip-bar"><i style={{ width: `${computed.recommend}%` }} /></span>
                  <b>{computed.stars ? `${computed.recommend}%` : "—"}</b>
                </div>
              </div>

              <div className="ip-review-list">
                {reviews.length ? reviews.map((review, index) => (
                  <article className="ip-review" key={`${review.created_at ?? "review"}-${index}`}>
                    <header>
                      <span className="ip-stars">{"★".repeat(Math.round(Number(review.overall_rating ?? 0)))}</span>
                      <small>{review.created_at ? new Date(review.created_at).toLocaleDateString("en-ZA", { dateStyle: "medium" }) : "Verified learner"}</small>
                    </header>
                    <p>{review.comments || review.went_well || review.improvements || "A verified lesson review."}</p>
                    {review.improvements && review.improvements !== review.comments && (
                      <small className="ip-review-note">Could improve: {review.improvements}</small>
                    )}
                  </article>
                )) : <p className="ip-lede">No public reviews yet. Be the first to review {name.split(" ")[0]} after your lesson.</p>}
              </div>
            </section>

            <section className="ip-section">
              <div className="auth-eyebrow">AVAILABILITY</div>
              <h2>Weekly availability</h2>
              <p className="ip-lede">Hours {name.split(" ")[0]} publishes for booking. Your exact lesson time is confirmed at checkout.</p>
              <div className="ip-week">
                {DAYS.map((day) => {
                  const windows = (instructor.availability_windows ?? []).filter((window) => window.day === day);
                  const start = windows.length ? Math.min(...windows.map((window) => hourOf(window.start))) : 99;
                  const end = windows.length ? Math.max(...windows.map((window) => hourOf(window.end))) : 0;
                  return (
                    <div className="ip-day" key={day}>
                      <b>{day.slice(0, 3)}</b>
                      <span className="ip-hours">
                        {HOURS.map((hour) => (
                          <i className={hour >= start && hour < end ? "on" : ""} key={hour} title={`${String(hour).padStart(2, "0")}:00`}>
                            {String(hour).padStart(2, "0")}
                          </i>
                        ))}
                      </span>
                      <em>{windows.length ? windows.map((window) => `${window.start}–${window.end}`).join(", ") : "Not available"}</em>
                    </div>
                  );
                })}
              </div>
              <div className="ip-week-legend"><span>06:00</span><span>13:00</span><span>20:00</span></div>
            </section>
          </div>

          <aside className="ip-book">
            <div className="ip-price-row">
              <div>
                <span>Starting from</span>
                <b>{zar(Number(instructor.hourly_rate ?? 0))}</b>
                <small>per hour</small>
              </div>
              {ownVehicleRate > 0 && (
                <div className="ip-own-rate">
                  <b>{zar(ownVehicleRate)}/hr</b>
                  <small>with your own vehicle</small>
                </div>
              )}
            </div>

            {ownVehicleRate > 0 && (
              <p className="ip-own">
                <Check size={13} />
                <span>Bring your own vehicle and pay {Number(instructor.own_vehicle_discount_percent)}% less — {zar(ownVehicleRate)} per hour.</span>
              </p>
            )}

            <button className="ip-book-button" onClick={book}>
              <CalendarDays size={15} /> Book a lesson
            </button>
            <div className="ip-secondary">
              <a className="ip-secondary-button" href="/learner/messages"><MessageCircle size={14} /> Message</a>
              <button className="ip-secondary-button" onClick={share}>Share</button>
            </div>

            {notice && <p className="ip-notice" role="status">{notice}</p>}

            <div className="ip-trust">
              <span><ShieldCheck size={13} /> Documents and credentials verified by MzansiDrive.</span>
              <span><Check size={13} /> Pay securely in ZAR with Paystack.</span>
              <span><Clock3 size={13} /> Full refund when you cancel 24 hours ahead.</span>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}

function SiteHeader() {
  const [open, setOpen] = useState(false);
  return (
    <header className="topbar">
      <a href="/" className="brand">
        <span className="brand-icon"><CarFront size={23} /></span>
        <span>mzansi<span className="brand-strong">drive</span><small>.co.za</small></span>
      </a>
      <nav className={open ? "nav-links open" : "nav-links"}>
        <a href="/#explore" onClick={() => setOpen(false)}>Find an instructor</a>
        <a href="/#how" onClick={() => setOpen(false)}>How it works</a>
        <a href="/#pricing" onClick={() => setOpen(false)}>Packages &amp; Pricing</a>
        <a href="/#enatis" onClick={() => setOpen(false)}>eNaTIS Radar</a>
        <a href="/#become" onClick={() => setOpen(false)}>Teach with us</a>
      </nav>
      <div className="top-actions">
        <a className="login-link" href="/login">Log in</a>
        <a className="signup-pill" href="/signup">Sign up</a>
      </div>
      <button className="mobile-menu" onClick={() => setOpen(!open)} aria-label="Toggle menu">☰</button>
    </header>
  );
}
