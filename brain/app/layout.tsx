import type { Metadata } from "next";
import { Fraunces, Space_Grotesk } from "next/font/google";
import "./globals.css";

// The same two voices Working Memory uses, so the siblings read as one system.
// Fraunces — the literary "memory" voice (wordmark, headings, article body).
const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  display: "swap",
  style: ["normal", "italic"],
});

// Space Grotesk — the interface voice (titles, labels, data).
const grotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-grotesk",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Brain",
  description: "Capture, read, and find everything you've saved.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${fraunces.variable} ${grotesk.variable}`}>
      <body>
        <div className="shell">
          <header className="masthead">
            <h1>
              <a href="/" style={{ textDecoration: "none" }}>
                🧠 Brain
              </a>
            </h1>
            <nav>
              <a href="/">Inbox</a>
              <a href="/library">Library</a>
              <a href="/ask">Ask</a>
              <a href="/chat">Chat</a>
              <a href="/kept">Kept</a>
            </nav>
            <form action="/search" method="get" className="navsearch">
              <input
                name="q"
                type="search"
                placeholder="Search everything…"
                aria-label="Search the library"
              />
            </form>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
