/** Images for the model: downscaled JPEGs as base64. Browser only. */

export interface Jpeg {
  mimeType: 'image/jpeg';
  data: string;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export async function canvasToJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Jpeg> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  if (!blob) throw new Error('could not encode the image');
  return { mimeType: 'image/jpeg', data: bytesToBase64(new Uint8Array(await blob.arrayBuffer())) };
}

/** A photo or scan, reduced so that its longer side is at most `maxSide` pixels. */
export async function imageFileToJpeg(file: Blob, maxSide = 1400, quality = 0.75): Promise<Jpeg> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('no 2d canvas');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await canvasToJpeg(canvas, quality);
  } finally {
    bitmap.close();
  }
}
