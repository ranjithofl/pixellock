import type { Metadata } from "next";
import ImageConverter from "./ImageConverter";

export const metadata: Metadata = {
  title: "PixelLock — Local Folder Image Compressor",
  description:
    "Convert a local Input folder into a matching Output folder without changing image dimensions.",
};

export default function Home() {
  return <ImageConverter />;
}
