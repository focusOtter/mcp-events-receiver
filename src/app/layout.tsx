import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://mcp-events-receiver-two.vercel.app"),
  title: "Otter Paws — MCP Events listening room",
  description: "A live feed of signed grooming appointment events, with friendly AI summaries.",
  openGraph: {
    type: "website",
    url: "/",
    title: "Otter Paws — MCP Events listening room",
    description: "Signed on departure. Verified on arrival. A live MCP Events feed with AI Gateway summaries.",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "Otter Paws listening room — a verified booking event with an AI summary" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Otter Paws — MCP Events listening room",
    description: "A live MCP Events feed with friendly AI Gateway summaries.",
    images: [{ url: "/og.png", alt: "Otter Paws listening room — a verified booking event with an AI summary" }],
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
