/**
 * Cheap, dependency-free image checks that run before any AI call. A blurry or
 * cropped photo costs the owner time and the shop money, so it is better to
 * ask for a retake immediately than to extract nonsense.
 */

export interface QualityReport {
  ok: boolean;
  width: number | null;
  height: number | null;
  sizeBytes: number;
  /** 0..1 rough sharpness proxy from JPEG compression density. */
  detailScore: number;
  reason?: string;
  advice?: string;
}

const MIN_BYTES = 12 * 1024;
const MIN_DIMENSION = 400;

export function checkImageQuality(buffer: Buffer, mimeType: string): QualityReport {
  const dimensions = readDimensions(buffer, mimeType);
  const sizeBytes = buffer.byteLength;
  // Bytes per pixel is a usable stand-in for detail in a camera photo: a
  // smooth (blurry or near-blank) frame compresses far more than a sharp one.
  // It says nothing about lossless formats, so PNG/WebP are judged on size
  // and resolution only.
  const lossy = mimeType.includes('jpeg') || mimeType.includes('jpg');
  const pixels = dimensions ? dimensions.width * dimensions.height : 0;
  const bytesPerPixel = pixels > 0 ? sizeBytes / pixels : 0;
  const detailScore = lossy ? Math.max(0, Math.min(1, bytesPerPixel / 0.35)) : 1;

  if (lossy && sizeBytes < MIN_BYTES) {
    return {
      ok: false,
      width: dimensions?.width ?? null,
      height: dimensions?.height ?? null,
      sizeBytes,
      detailScore,
      reason: 'IMAGE_TOO_SMALL',
      advice: 'The photo is too small to read. Please take another photo closer to the paper.',
    };
  }

  if (dimensions && (dimensions.width < MIN_DIMENSION || dimensions.height < MIN_DIMENSION)) {
    return {
      ok: false,
      width: dimensions.width,
      height: dimensions.height,
      sizeBytes,
      detailScore,
      reason: 'LOW_RESOLUTION',
      advice: 'This photo is low resolution. Please take another photo in better light.',
    };
  }

  if (lossy && pixels > 0 && detailScore < 0.06) {
    return {
      ok: false,
      width: dimensions?.width ?? null,
      height: dimensions?.height ?? null,
      sizeBytes,
      detailScore,
      reason: 'BLURRY',
      advice: 'Image is too blurry. Please take another photo holding the phone steady.',
    };
  }

  return {
    ok: true,
    width: dimensions?.width ?? null,
    height: dimensions?.height ?? null,
    sizeBytes,
    detailScore,
  };
}

function readDimensions(buffer: Buffer, mimeType: string): { width: number; height: number } | null {
  try {
    if (mimeType.includes('png')) return readPngDimensions(buffer);
    if (mimeType.includes('jpeg') || mimeType.includes('jpg')) return readJpegDimensions(buffer);
  } catch {
    return null;
  }
  return null;
}

function readPngDimensions(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 24 || buffer.toString('ascii', 1, 4) !== 'PNG') return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function readJpegDimensions(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  while (offset < buffer.length - 9) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);
    // SOF0..SOF15, skipping the non-dimension markers in that range.
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
    }
    offset += 2 + length;
  }
  return null;
}
