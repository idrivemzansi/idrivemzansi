// Photos arrive from phones at 4000px+ and 8 MB; nothing downstream needs that. Re-encoding in the
// browser keeps uploads, S3 storage and the AI document check small without a server-side image library.
// Only JPEG is touched: PNG and WebP may carry transparency (logos, scans) and re-encoding them would
// change what the user picked. Anything that fails to decode simply uploads as-is.
const MAX_EDGE = 1600;
const QUALITY = 0.85;

export async function optimiseImage(file: File): Promise<File> {
  if (file.type !== "image/jpeg") return file;
  try {
    const source = await createImageBitmap(file, { imageOrientation: "from-image" }).catch(() => createImageBitmap(file));
    const longest = Math.max(source.width, source.height);
    const scale = Math.min(1, MAX_EDGE / longest);
    if (scale === 1 && file.size <= 500 * 1024) { source.close(); return file; }

    const width = Math.max(1, Math.round(source.width * scale));
    const height = Math.max(1, Math.round(source.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) { source.close(); return file; }
    context.drawImage(source, 0, 0, width, height);
    source.close();

    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", QUALITY));
    if (!blob || blob.size >= file.size) return file;
    const baseName = file.name.replace(/\.[^.]+$/, "") || "upload";
    return new File([blob], `${baseName}.jpg`, { type: "image/jpeg", lastModified: file.lastModified });
  } catch {
    return file;
  }
}
