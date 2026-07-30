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
              <a href="/kept">Kept</a>
            </nav>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
