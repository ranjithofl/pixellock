import type { Metadata } from "next";
import ImageConverter from "./ImageConverter";

export const metadata: Metadata = {
  title: "PixelLock — Strict Dimension Image Compressor",
  description:
    "Compress images to a strict file-size limit without changing a single pixel dimension.",
};

export default function Home() {
  return <ImageConverter />;
}
