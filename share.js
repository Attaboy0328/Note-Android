export async function shareAsText(title, plainText) {
  const text = `${title}\n\n${plainText}`.trim();
  if (navigator.share) {
    await navigator.share({ title, text });
    return;
  }
  await navigator.clipboard.writeText(text);
}

export async function shareAsLink(noteId) {
  const url = `${location.origin}${location.pathname}?note=${encodeURIComponent(noteId)}`;
  if (navigator.share) {
    await navigator.share({ title: "Note", url });
    return url;
  }
  await navigator.clipboard.writeText(url);
  return url;
}

export function downloadBlob(filename, blob) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

export async function shareAsWord(title, html) {
  const doc = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><title>${title}</title></head><body>${html}</body></html>`;
  const blob = new Blob(["\ufeff", doc], { type: "application/msword" });
  downloadBlob(`${title || "笔记"}.doc`, blob);
}

export async function shareAsImage(title, plainText) {
  const canvas = document.createElement("canvas");
  const width = 720;
  const padding = 48;
  const lineHeight = 34;
  const lines = wrapText(plainText || " ", width - padding * 2, 22);
  const titleLines = wrapText(title || "无标题", width - padding * 2, 28);
  canvas.width = width;
  canvas.height = padding * 2 + titleLines.length * 40 + lines.length * lineHeight + 40;

  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fffcf8";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#2c2825";
  ctx.font = "bold 28px 'Noto Sans SC', sans-serif";
  let y = padding + 28;
  titleLines.forEach((line) => {
    ctx.fillText(line, padding, y);
    y += 40;
  });
  y += 12;
  ctx.font = "22px 'Noto Serif SC', serif";
  lines.forEach((line) => {
    ctx.fillText(line, padding, y);
    y += lineHeight;
  });

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  const file = new File([blob], `${title || "笔记"}.png`, { type: "image/png" });
  if (navigator.share && navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], title });
    return;
  }
  downloadBlob(file.name, blob);
}

function wrapText(text, maxWidth, fontSize) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  ctx.font = `${fontSize}px sans-serif`;
  const paragraphs = String(text).split(/\r?\n/);
  const lines = [];
  paragraphs.forEach((paragraph) => {
    if (!paragraph) {
      lines.push("");
      return;
    }
    let current = "";
    [...paragraph].forEach((char) => {
      const next = current + char;
      if (ctx.measureText(next).width > maxWidth && current) {
        lines.push(current);
        current = char;
      } else {
        current = next;
      }
    });
    if (current) lines.push(current);
  });
  return lines.length ? lines : [""];
}
