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
    title: "We Read Your Receipts",
    desc: "Return Window sees your order emails — and nothing else. However they reach us, your inbox stays private and entirely yours.",
  },
  {
    title: "We Track Every Deadline",
    desc: "Every retailer, order, and return policy is understood automatically. Your return windows and shipments, in one quiet place.",
  },
  {
    title: "We Remind You in Time",
    desc: "Alerts by email and SMS* at the moments that matter: seven days, two days, one day, and the day itself. Nothing slips through.",
  },
  {
    title: "We Follow Every Refund",
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
      padding: "20px 0",
    }}>
      <div style={{
        fontFamily: "'Cormorant Garamond', serif",
        fontSize: 18,
        fontWeight: 600,
        letterSpacing: 0.2,
        marginBottom: 4,
        lineHeight: 1.3,
      }}>{name}</div>
      <div style={{
        fontSize: 11,
        color: "#888",
        letterSpacing: 1.5,
        textTransform: "uppercase",
        fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
        marginBottom: 12,
      }}>
        {ordered} — {deadline}
      </div>
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
      }}>
        <div style={{
          fontFamily: "'Cormorant Garamond', serif",
          fontSize: 19,
          fontWeight: 500,
        }}>{price}</div>
        <div style={{
          fontSize: 10,
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
        padding: "20px 24px",
        borderBottom: "1px solid #000",
      }}>
        <div style={{
          fontFamily: "'Cormorant Garamond', serif",
          fontSize: 20,
          fontWeight: 700,
          letterSpacing: 2,
          lineHeight: 1.2,
        }}>
          RETURN<br />WINDOW
        </div>
        <div style={{ display: "flex", gap: 24, alignItems: "center" }}>
          <span style={{ ...labelStyle, color: "#aaa", fontSize: 9, letterSpacing: 2.5 }}>
            Coming soon
          </span>
          <a
            href="https://app.myreturnwindow.com"
            style={{
              ...labelStyle,
              color: "#000",
              fontSize: 10,
              textDecoration: "none",
              borderBottom: "1px solid #000",
              paddingBottom: 2,
            }}
          >
            Sign in
          </a>
        </div>
      </nav>

      {/* Hero */}
      <section style={{
        padding: "64px 24px 56px",
        maxWidth: 600,
        margin: "0 auto",
        textAlign: "center",
      }}>
        <div style={{ ...labelStyle, marginBottom: 28 }}>
          The return deadline tracker
        </div>
        <h1 style={{
          fontFamily: "'Cormorant Garamond', serif",
          fontSize: "clamp(34px, 8vw, 58px)",
          fontWeight: 300,
          lineHeight: 1.08,
          letterSpacing: -0.5,
          margin: "0 0 24px",
          fontStyle: "italic",
        }}>
          Never miss a<br />return window again.
        </h1>
        <p style={{
          fontSize: 15,
          lineHeight: 1.75,
          color: "#555",
          maxWidth: 440,
          margin: "0 auto 40px",
          letterSpacing: 0.2,
        }}>
          Return Window tracks every purchase&apos;s return deadline and refund, and reminds you by email and SMS* before it&apos;s too late — privately, securely, automatically.
        </p>

        {!submitted ? (
          <div style={{ maxWidth: 440, margin: "0 auto" }}>
            <input
              type="email"
              placeholder="Your email address"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setEmailError(""); }}
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              style={{
                width: "100%",
                padding: "16px 20px",
                fontSize: 15,
                fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
                border: "1px solid #000",
                borderBottom: "none",
                outline: "none",
                letterSpacing: 0.5,
                boxSizing: "border-box",
              }}
            />
            <button
              onClick={handleSubmit}
              onMouseEnter={() => setHoveredBtn("hero")}
              onMouseLeave={() => setHoveredBtn(null)}
              disabled={submitting}
              style={{
                width: "100%",
                padding: "16px 44px",
                fontSize: 11,
                fontWeight: 500,
                letterSpacing: 3,
                textTransform: "uppercase",
                fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
                background: hoveredBtn === "hero" ? "#333" : "#000",
                color: "#fff",
                border: "none",
                cursor: "pointer",
                transition: "background 0.3s",
                opacity: submitting ? 0.6 : 1,
              }}
            >
              {submitting ? "One moment…" : "Request Access"}
            </button>
            {emailError && (
              <div style={{ color: "#C41E1E", fontSize: 12, marginTop: 12, letterSpacing: 0.5 }}>
                {emailError}
              </div>
            )}
            <div style={{ ...labelStyle, marginTop: 16, color: "#aaa", letterSpacing: 2, fontSize: 9, lineHeight: 1.6 }}>
              Request access to early beta testing · No spam · Unsubscribe anytime
            </div>
          </div>
        ) : (
          <div style={{
            border: "1px solid #000",
            padding: "24px 28px",
            maxWidth: 440,
            margin: "0 auto",
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
              flex: "1 1 240px",
              padding: "36px 24px",
              textAlign: "center",
              borderBottom: "1px solid #E0E0E0",
            }}>
              <div style={{ ...labelStyle, marginBottom: 12, lineHeight: 1.6 }}>
                {s.top}<br />{s.bottom}
              </div>
              <div style={{
                fontFamily: "'Cormorant Garamond', serif",
                fontSize: "clamp(32px, 8vw, 42px)",
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
          padding: "0 24px 20px",
          fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
        }}>
          Sources: LendingTree consumer survey, 2025 · National Retail Federation, 2024
        </div>
      </section>

      {/* How it works */}
      <section style={{
        borderTop: "1px solid #E0E0E0",
        maxWidth: 600,
        margin: "0 auto",
        padding: "56px 24px",
      }}>
        <div style={{ ...labelStyle, textAlign: "center", marginBottom: 40 }}>
          How it works
        </div>
        {FEATURES.map((f, i) => (
          <div key={i} style={{
            display: "flex",
            gap: 24,
            alignItems: "flex-start",
            padding: "28px 0",
            borderBottom: i < FEATURES.length - 1 ? "1px solid #E0E0E0" : "none",
          }}>
            <div style={{
              fontFamily: "'Cormorant Garamond', serif",
              fontSize: 32,
              fontWeight: 300,
              color: "#ccc",
              lineHeight: 1,
              minWidth: 32,
            }}>
              {i + 1}
            </div>
            <div>
              <h3 style={{
                fontFamily: "'Cormorant Garamond', serif",
                fontSize: 22,
                fontWeight: 500,
                margin: "0 0 8px",
                letterSpacing: 0.2,
                lineHeight: 1.25,
              }}>{f.title}</h3>
              <p style={{
                fontSize: 14,
                lineHeight: 1.7,
                color: "#555",
                margin: 0,
                letterSpacing: 0.2,
              }}>{f.desc}</p>
              {i === 2 && (
                <p style={{
                  fontSize: 12,
                  color: "#999",
                  margin: "10px 0 0",
                  letterSpacing: 0.3,
                  fontStyle: "italic",
                  lineHeight: 1.6,
                }}>*SMS coming soon</p>
              )}
            </div>
          </div>
        ))}
      </section>

      {/* Preview widget */}
      <section style={{
        background: "#FAFAFA",
        borderTop: "1px solid #E0E0E0",
        borderBottom: "1px solid #E0E0E0",
        padding: "56px 24px",
      }}>
        <div style={{ maxWidth: 520, margin: "0 auto" }}>
          <div style={{ ...labelStyle, marginBottom: 28, textAlign: "center" }}>
            Your dashboard
          </div>
          <div style={{
            background: "#fff",
            border: "1px solid #E0E0E0",
            padding: "4px 24px",
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
        maxWidth: 520,
        margin: "0 auto",
        padding: "56px 24px 24px",
        textAlign: "center",
      }}>
        <div style={{ ...labelStyle, marginBottom: 24 }}>Privacy</div>
        <div style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 10,
          fontSize: 14,
          color: "#555",
          letterSpacing: 0.3,
        }}>
          {[
            "We see your shopping emails — nothing else",
            "Email content encrypted at rest",
            "Never sold, never shared",
            "Delete your data at any time",
          ].map((t, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 7, color: "#000" }}>■</span> {t}
            </div>
          ))}
        </div>
      </section>

      {/* Bottom CTA */}
      <section style={{
        maxWidth: 520,
        margin: "0 auto",
        padding: "48px 24px 40px",
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
          fontSize: "clamp(28px, 6vw, 38px)",
          fontWeight: 400,
          fontStyle: "italic",
          letterSpacing: -0.5,
          margin: "0 0 16px",
          lineHeight: 1.15,
        }}>
          Don&apos;t miss a return window ever again.
        </h2>
        <p style={{
          fontSize: 14,
          color: "#555",
          marginBottom: 36,
          letterSpacing: 0.3,
          lineHeight: 1.7,
          maxWidth: 420,
          marginLeft: "auto",
          marginRight: "auto",
        }}>
          Refunds go wrong more often than you&apos;d think — short, slow, or missing entirely. Return Window follows every return until the money is back. Coming soon: request access to the early beta.
        </p>
        {!submitted ? (
          <div style={{ maxWidth: 440, margin: "0 auto" }}>
            <input
              type="email"
              placeholder="Your email address"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setEmailError(""); }}
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              style={{
                width: "100%",
                padding: "16px 20px",
                fontSize: 15,
                fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
                border: "1px solid #000",
                borderBottom: "none",
                outline: "none",
                letterSpacing: 0.5,
                boxSizing: "border-box",
              }}
            />
            <button
              onClick={handleSubmit}
              onMouseEnter={() => setHoveredBtn("bottom")}
              onMouseLeave={() => setHoveredBtn(null)}
              disabled={submitting}
              style={{
                width: "100%",
                padding: "16px 44px",
                fontSize: 11,
                fontWeight: 500,
                letterSpacing: 3,
                textTransform: "uppercase",
                fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
                background: hoveredBtn === "bottom" ? "#333" : "#000",
                color: "#fff",
                border: "none",
                cursor: "pointer",
                transition: "background 0.3s",
                opacity: submitting ? 0.6 : 1,
              }}
            >
              {submitting ? "One moment…" : "Request Access"}
            </button>
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
        padding: "24px",
      }}>
        <div style={{ fontSize: 11, color: "#888", letterSpacing: 1.5, marginBottom: 10 }}>
          © 2026 RETURN WINDOW
        </div>
        <div style={{ display: "flex", gap: 24 }}>
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
