import "./styles.css";
import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "ForecastEdge",
  description: "Weather forecast delta monitoring and staged Kalshi trading assistant",
  icons: [{ rel: "icon", url: "/icon.svg", type: "image/svg+xml" }]
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
