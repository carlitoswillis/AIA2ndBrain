import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Brain — Inbox",
  description: "Capture and reader for AIA2ndBrain",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
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
