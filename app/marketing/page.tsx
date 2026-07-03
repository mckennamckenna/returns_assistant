"use client";

import { useState, useEffect } from "react";

function BillionCounter() {
  const [n, setN] = useState(0);
  useEffect(() => {
    const target = 890;
    const duration = 2200;
    const start = performance.now();
    let frame: number;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
      setN(Math.round(target * eased));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);
  return <span style={{ fontVariantNumeric: "tabular-nums" }}>${n}B</span>;
}

const FEATURES = [
  {
    title: "Your Purchases, Captured",
    desc: "Return Window sees your order emails — and nothing else. However they reach us, your inbox stays private and entirely yours.",
  },
  {
    title: "Deadlines & Tracking, Managed",
    desc: "Every retailer, order, and return policy is understood automatically. Your return windows and shipments, in one quiet place.",
  },
  {
    title: "Reminders Before It Closes",
    desc: "Alerts at the moments that matter: seven days, two days, one day, and the day itself. Nothing slips through.",
  },
  {
    title: "The Loop, Closed",
    desc: "Sent something back? We follow up until the refund actually lands — and nudge you to check the amount matches what you paid.",
  },
];

type ReturnCardProps = {
  name: string;
  price: string;
  ordered: string;
  deadline: string;
  daysLeft: string;
  urgent?: boolean;
};

function ReturnCard({ name, price, ordered, deadline, daysLeft, urgent }: ReturnCardProps) {
  return (
    <div style={{
      borderBottom: "1px solid #E0E0E0",
      padding: "22px 0",
      display: "flex",
      justifyContent: "space-between",
      alignItems: "flex-start",
      gap: 20,
      flexWrap: "wrap",
    }}>
      <div style={{ flex: "1 1 200px" }}>
        <div style={{
          fontFamily: "'Cormorant Garamond', serif",
          fontSize: 19,
          fontWeight: 600,
          letterSpacing: 0.2,
          marginBottom: 4,
        }}>{name}</div>
        <div style={{
          fontSize: 12,
          color: "#888",
          letterSpacing: 1.5,
          textTransform: "uppercase",
          fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
        }}>
          {ordered} — {deadline}
        </div>
      </div>
      <div style={{ textAlign: "right", minWidth: 120 }}>
        <div style={{
          fontFamily: "'Cormorant Garamond', serif",
          fontSize: 19,
          fontWeight: 500,
          marginBottom: 4,
        }}>{price}</div>
        <div style={{
          fontSize: 11,
          letterSpacing: 2,
          textTransform: "uppercase",
          fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
          color: urgent ? "#C41E1E" : "#888",
          fontWeight: urgent ? 600 : 400,
        }}>
          {daysLeft} days remaining
        </div>
      </div>
    </div>
  );
}

export default function MyReturnWindowLanding() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [emailError, setEmailError] = useState("");
  const [hoveredBtn, setHoveredBtn] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setEmailError("Please enter a valid email address.");
      return;
    }
    setEmailError("");
    setSubmitting(true);
    try {
      const res = await fetch("/api/beta-signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      if (!res.ok) throw new Error("signup failed");
      setSubmitted(true);
    } catch {
      setEmailError("Something went wrong — please try again in a moment.");
    } finally {
      setSubmitting(false);
    }
  };

  const btnStyle = (id: string) => ({
    padding: "16px 44px",
    fontSize: 11,
    fontWeight: 500,
    letterSpacing: 3,
    textTransform: "uppercase" as const,
    fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
    background: hoveredBtn === id ? "#333" : "#000",
    color: "#fff",
    border: "none",
    cursor: "pointer",
    transition: "background 0.3s",
  });

  const inputStyle = {
    padding: "16px 20px",
    fontSize: 14,
    fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
    border: "1px solid #000",
    outline: "none",
    letterSpacing: 0.5,
    width: "100%",
    maxWidth: 340,
    boxSizing: "border-box" as const,
  };

  const labelStyle = {
    fontSize: 10,
    letterSpacing: 3.5,
    textTransform: "uppercase" as const,
    fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
    color: "#888",
    fontWeight: 500,
  };

  return (
    <div style={{
      fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
      color: "#000",
      background: "#fff",
      minHeight: "100vh",
      WebkitFontSmoothing: "antialiased",
    }}>
      {/* Nav */}
      <nav style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "24px 40px",
        borderBottom: "1px solid #000",
      }}>
        <div style={{
          fontFamily: "'Cormorant Garamond', serif",
          fontSize: 22,
          fontWeight: 600,
          letterSpacing: 1,
        }}>
          RETURN WINDOW
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
          <div style={labelStyle}>
            Coming Soon
          </div>
          <a
            href="https://app.myreturnwindow.com"
            style={{ ...labelStyle, color: "#000", textDecoration: "none", borderBottom: "1px solid #000", paddingBottom: 2 }}
          >
            Sign in
          </a>
        </div>
      </nav>

      {/* Hero */}
      <section style={{
        padding: "80px 40px 72px",
        maxWidth: 820,
        margin: "0 auto",
        textAlign: "center",
      }}>
        <div style={{ ...labelStyle, marginBottom: 32 }}>
          The return deadline tracker
        </div>
        <h1 style={{
          fontFamily: "'Cormorant Garamond', serif",
          fontSize: "clamp(36px, 6vw, 68px)",
          fontWeight: 300,
          lineHeight: 1.08,
          letterSpacing: -1,
          margin: "0 0 28px",
          fontStyle: "italic",
        }}>
          Never miss a<br />return window again.
        </h1>
        <p style={{
          fontSize: 15,
          lineHeight: 1.75,
          color: "#555",
          maxWidth: 480,
          margin: "0 auto 44px",
          letterSpacing: 0.2,
        }}>
          Return Window tracks every purchase&apos;s return deadline and refund — privately, securely, automatically. Coming soon.
        </p>

        {!submitted ? (
          <div>
            <div style={{
              display: "flex",
              gap: 0,
              justifyContent: "center",
              flexWrap: "wrap",
              maxWidth: 560,
              margin: "0 auto",
            }}>
              <input
                type="email"
                placeholder="Your email address"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setEmailError(""); }}
                onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                style={{
                  ...inputStyle,
                  borderRight: "none",
                  flex: "1 1 240px",
                }}
              />
              <button
                onClick={handleSubmit}
                onMouseEnter={() => setHoveredBtn("hero")}
                onMouseLeave={() => setHoveredBtn(null)}
                disabled={submitting}
                style={{ ...btnStyle("hero"), whiteSpace: "nowrap", opacity: submitting ? 0.6 : 1 }}
              >
                {submitting ? "One moment…" : "Request Access"}
              </button>
            </div>
            {emailError && (
              <div style={{ color: "#C41E1E", fontSize: 12, marginTop: 12, letterSpacing: 0.5 }}>
                {emailError}
              </div>
            )}
            <div style={{ ...labelStyle, marginTop: 20, color: "#aaa", letterSpacing: 2.5, fontSize: 9 }}>
              Request access to early beta testing · No spam · Unsubscribe anytime
            </div>
          </div>
        ) : (
          <div style={{
            border: "1px solid #000",
            padding: "24px 36px",
            display: "inline-block",
          }}>
            <div style={{
              fontFamily: "'Cormorant Garamond', serif",
              fontSize: 22,
              fontWeight: 500,
              marginBottom: 6,
            }}>You&apos;re on the list.</div>
            <div style={{ fontSize: 13, color: "#555", letterSpacing: 0.3 }}>
              We&apos;ll notify <strong>{email}</strong> when your access is ready.
            </div>
          </div>
        )}
      </section>

      {/* Stat band */}
      <section style={{ borderTop: "1px solid #000", borderBottom: "1px solid #000" }}>
        <div style={{
          maxWidth: 1000,
          margin: "0 auto",
          display: "flex",
          flexWrap: "wrap",
        }}>
          {[
            { top: "Of shoppers have missed", bottom: "a return they meant to make", value: "44%" },
            { top: "Kept something they didn't want —", bottom: "returning it felt too hard", value: "58%" },
            { top: "In merchandise returned", bottom: "in the U.S. last year", value: <BillionCounter /> },
          ].map((s, i) => (
            <div key={i} style={{
              flex: "1 1 200px",
              padding: "44px 32px",
              textAlign: "center",
              borderRight: i < 2 ? "1px solid #E0E0E0" : "none",
            }}>
              <div style={{ ...labelStyle, marginBottom: 12, lineHeight: 1.6 }}>
                {s.top}<br />{s.bottom}
              </div>
              <div style={{
                fontFamily: "'Cormorant Garamond', serif",
                fontSize: 42,
                fontWeight: 300,
                letterSpacing: -1,
              }}>
                {s.value}
              </div>
            </div>
          ))}
        </div>
        <div style={{
          textAlign: "center",
          fontSize: 9,
          color: "#bbb",
          letterSpacing: 1.5,
          textTransform: "uppercase",
          padding: "0 32px 20px",
          fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
        }}>
          Sources: LendingTree consumer survey, 2025 · National Retail Federation, 2024
        </div>
      </section>

      {/* How it works */}
      <section style={{ maxWidth: 720, margin: "0 auto", padding: "80px 40px" }}>
        <div style={{ ...labelStyle, textAlign: "center", marginBottom: 40 }}>
          How it works
        </div>
        {FEATURES.map((f, i) => (
          <div key={i} style={{
            display: "flex",
            gap: 28,
            alignItems: "flex-start",
            padding: "32px 0",
            borderTop: "1px solid #E0E0E0",
          }}>
            <div style={{
              fontFamily: "'Cormorant Garamond', serif",
              fontSize: 36,
              fontWeight: 300,
              color: "#ccc",
              lineHeight: 1,
              minWidth: 36,
            }}>
              {i + 1}
            </div>
            <div>
              <h3 style={{
                fontFamily: "'Cormorant Garamond', serif",
                fontSize: 24,
                fontWeight: 500,
                margin: "0 0 8px",
                letterSpacing: 0.2,
              }}>{f.title}</h3>
              <p style={{
                fontSize: 14,
                lineHeight: 1.7,
                color: "#555",
                margin: 0,
                letterSpacing: 0.2,
              }}>{f.desc}</p>
            </div>
          </div>
        ))}
      </section>

      {/* Preview widget */}
      <section style={{
        background: "#FAFAFA",
        borderTop: "1px solid #E0E0E0",
        borderBottom: "1px solid #E0E0E0",
        padding: "64px 40px",
      }}>
        <div style={{ maxWidth: 620, margin: "0 auto" }}>
          <div style={{ ...labelStyle, marginBottom: 32, textAlign: "center" }}>
            Your dashboard
          </div>
          <div style={{
            background: "#fff",
            border: "1px solid #E0E0E0",
            padding: "8px 28px",
          }}>
            <ReturnCard
              name="Acne Studios — Oversized Wool Coat"
              price="$1,250.00"
              ordered="Jun 2"
              deadline="Jul 2"
              daysLeft="1"
              urgent
            />
            <ReturnCard
              name="Aesop — Reverence Hand Wash Duo"
              price="$89.00"
              ordered="Jun 18"
              deadline="Jul 18"
              daysLeft="17"
            />
            <ReturnCard
              name="Common Projects — Original Achilles Low"
              price="$425.00"
              ordered="Jun 22"
              deadline="Aug 5"
              daysLeft="35"
            />
          </div>
        </div>
      </section>

      {/* Privacy */}
      <section style={{
        maxWidth: 720,
        margin: "0 auto",
        padding: "64px 40px 24px",
        textAlign: "center",
      }}>
        <div style={{ ...labelStyle, marginBottom: 28 }}>Privacy</div>
        <div style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          gap: "12px 40px",
          fontSize: 13,
          color: "#555",
          letterSpacing: 0.3,
        }}>
          {[
            "We see your shopping emails — nothing else",
            "Email content encrypted at rest",
            "Never sold, never shared",
            "Delete your data at any time",
          ].map((t, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 8, color: "#000" }}>■</span> {t}
            </div>
          ))}
        </div>
      </section>

      {/* Bottom CTA */}
      <section style={{
        maxWidth: 600,
        margin: "0 auto",
        padding: "60px 40px 48px",
        textAlign: "center",
      }}>
        <div style={{
          width: 48,
          height: 1,
          background: "#000",
          margin: "0 auto 40px",
        }} />
        <h2 style={{
          fontFamily: "'Cormorant Garamond', serif",
          fontSize: 36,
          fontWeight: 400,
          fontStyle: "italic",
          letterSpacing: -0.5,
          margin: "0 0 14px",
        }}>
          Don&apos;t miss a return window ever again.
        </h2>
        <p style={{
          fontSize: 14,
          color: "#555",
          marginBottom: 36,
          letterSpacing: 0.3,
        }}>
          Refunds go wrong more often than you&apos;d think — short, slow, or missing entirely. Return Window follows every return until the money is back. Coming soon: request access to the early beta.
        </p>
        {!submitted ? (
          <div>
            <div style={{
              display: "flex",
              gap: 0,
              justifyContent: "center",
              flexWrap: "wrap",
              maxWidth: 520,
              margin: "0 auto",
            }}>
              <input
                type="email"
                placeholder="Your email address"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setEmailError(""); }}
                onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                style={{
                  ...inputStyle,
                  borderRight: "none",
                  flex: "1 1 220px",
                }}
              />
              <button
                onClick={handleSubmit}
                onMouseEnter={() => setHoveredBtn("bottom")}
                onMouseLeave={() => setHoveredBtn(null)}
                disabled={submitting}
                style={{ ...btnStyle("bottom"), opacity: submitting ? 0.6 : 1 }}
              >
                {submitting ? "One moment…" : "Request Access"}
              </button>
            </div>
          </div>
        ) : (
          <div style={{
            fontFamily: "'Cormorant Garamond', serif",
            fontSize: 20,
            fontWeight: 500,
          }}>
            You&apos;re on the list. We&apos;ll be in touch.
          </div>
        )}
      </section>

      {/* Footer */}
      <footer style={{
        borderTop: "1px solid #E0E0E0",
        padding: "28px 40px",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 12,
      }}>
        <div style={{ fontSize: 12, color: "#888", letterSpacing: 1 }}>
          © 2026 RETURN WINDOW
        </div>
        <div style={{ display: "flex", gap: 28 }}>
          {["Privacy", "Terms", "Contact"].map((t) => (
            <span key={t} style={{
              fontSize: 10,
              letterSpacing: 2.5,
              textTransform: "uppercase",
              color: "#888",
              cursor: "pointer",
            }}>{t}</span>
          ))}
        </div>
      </footer>
    </div>
  );
}
