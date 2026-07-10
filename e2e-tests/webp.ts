/**
 * Reads the image dimensions from a WebP file, so the tests can assert on them
 * without depending on a local ImageMagick installation.
 *
 * @see https://developers.google.com/speed/webp/docs/riff_container
 */
export const webpSize = (
  webp: Buffer,
): {
  width: number;
  height: number;
  format: "lossy" | "lossless" | "extended";
} => {
  if (webp.toString("ascii", 0, 4) !== "RIFF")
    throw new Error(`Not a RIFF container!`);
  if (webp.toString("ascii", 8, 12) !== "WEBP")
    throw new Error(`Not a WebP file!`);

  const chunk = webp.toString("ascii", 12, 16);
  switch (chunk) {
    // Simple file format (lossy)
    case "VP8 ": {
      // 3 byte frame tag, followed by the start code
      if (webp.readUIntBE(23, 3) !== 0x9d012a)
        throw new Error(`Missing VP8 key frame start code!`);
      return {
        width: webp.readUInt16LE(26) & 0x3fff,
        height: webp.readUInt16LE(28) & 0x3fff,
        format: "lossy",
      };
    }
    // Simple file format (lossless)
    case "VP8L": {
      if (webp[20] !== 0x2f) throw new Error(`Missing VP8L signature byte!`);
      // 14 bits width - 1, followed by 14 bits height - 1
      const bits = webp.readUInt32LE(21);
      return {
        width: (bits & 0x3fff) + 1,
        height: ((bits >> 14) & 0x3fff) + 1,
        format: "lossless",
      };
    }
    // Extended file format, e.g. an image with an alpha channel
    case "VP8X": {
      return {
        width: webp.readUIntLE(24, 3) + 1,
        height: webp.readUIntLE(27, 3) + 1,
        format: "extended",
      };
    }
    default:
      throw new Error(`Unsupported WebP chunk: ${chunk}!`);
  }
};
