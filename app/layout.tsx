import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ??
    requestHeaders.get("host") ??
    "localhost:3000";
  const protocol =
    requestHeaders.get("x-forwarded-proto") ??
    (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;
  const socialImage = new URL("/og.png", origin).toString();

  return {
    metadataBase: new URL(origin),
    title: "PixelLock — Strict Dimension Image Compressor",
    description:
      "Compress images to a strict file-size ceiling while preserving their original pixel dimensions.",
    openGraph: {
      title: "PixelLock — Every pixel stays",
      description:
        "A private, browser-based image compressor with strict size ceilings and locked dimensions.",
      type: "website",
      images: [{ url: socialImage, width: 1730, height: 909, alt: "PixelLock — Smaller files. Every pixel stays." }],
    },
    twitter: {
      card: "summary_large_image",
      title: "PixelLock — Every pixel stays",
      description: "Smaller files. Original dimensions. Private browser processing.",
      images: [socialImage],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        {children}
      </body>
    </html>
  );
}
