/**
 * Renders finished 1920x1080 signage slides on a <canvas>, matching the
 * "photo + caption" / "collage" / "announcement" look used across the
 * screens today (blurred backdrop so group photos never get faces cropped,
 * bottom gradient caption bar, institutional green for ready-made flyers).
 * Kept in the frontend (no server-side image processing) so Content Studio
 * can show a live preview and export the same canvas it renders.
 */

const W = 1920;
const H = 1080;
const DARK_GREEN = "rgb(14, 46, 26)";
const DARK_GREEN2 = "rgb(8, 28, 16)";
const ACCENT_GREEN = "rgb(57, 181, 79)";
const FONT = '"Segoe UI", Arial, sans-serif';

export function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

function containSize(img, maxW, maxH) {
  const ratio = Math.min(maxW / img.width, maxH / img.height);
  return { w: img.width * ratio, h: img.height * ratio };
}

/** Crops `img` to cover a dx/dy/dw/dh rect, biased toward the top third so
 * group-photo faces stay in frame instead of getting cut by the crop. */
function drawCover(ctx, img, dx, dy, dw, dh, centerY = 0.38) {
  const srcRatio = img.width / img.height;
  const dstRatio = dw / dh;
  let sx, sy, sw, sh;
  if (srcRatio > dstRatio) {
    sh = img.height;
    sw = sh * dstRatio;
    sx = (img.width - sw) / 2;
    sy = 0;
  } else {
    sw = img.width;
    sh = sw / dstRatio;
    sx = 0;
    sy = Math.max(0, (img.height - sh) * centerY);
  }
  ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
}

function drawBlurredBackdrop(ctx, img, x, y, w, h) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.filter = "blur(24px)";
  drawCover(ctx, img, x - 30, y - 30, w + 60, h + 60);
  ctx.filter = "none";
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}

function drawLogoTag(ctx, x, y) {
  ctx.fillStyle = ACCENT_GREEN;
  ctx.font = `700 30px ${FONT}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText("CAPTA VALE", x, y);
}

/** One photo, full-bleed with a blurred backdrop, title + subtitle in a
 * bottom gradient bar. */
export function renderPhotoSlide(canvas, img, title, subtitle) {
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");

  drawBlurredBackdrop(ctx, img, 0, 0, W, H);

  const maxW = W - 160;
  const maxH = H - 340;
  const { w: fw, h: fh } = containSize(img, maxW, maxH);
  const fx = (W - fw) / 2;
  const fy = 60 + (maxH - fh) / 2;
  ctx.drawImage(img, fx, fy, fw, fh);

  const barH = 240;
  const grad = ctx.createLinearGradient(0, H - barH, 0, H);
  grad.addColorStop(0, "rgba(6,20,12,0)");
  grad.addColorStop(1, "rgba(6,20,12,0.9)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, H - barH, W, barH);
  ctx.fillStyle = ACCENT_GREEN;
  ctx.fillRect(0, H - 10, W, 10);

  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.fillStyle = "#ffffff";
  ctx.font = `700 58px ${FONT}`;
  ctx.fillText(title || "", 70, H - 120);

  ctx.fillStyle = "rgb(210,225,216)";
  ctx.font = `400 32px ${FONT}`;
  ctx.fillText(subtitle || "", 70, H - 80);

  drawLogoTag(ctx, 70, 40);
}

/** Two photos side by side, each with its own blurred backdrop, shared
 * title bar on top. */
export function renderCollageSlide(canvas, img1, img2, title, subtitle) {
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = DARK_GREEN2;
  ctx.fillRect(0, 0, W, H);

  const topBarH = 170;
  const gap = 10;
  const photoH = H - topBarH;
  const colW = (W - gap) / 2;

  [img1, img2].forEach((img, i) => {
    if (!img) return;
    const x = i * (colW + gap);
    drawBlurredBackdrop(ctx, img, x, topBarH, colW, photoH);
    const { w: fw, h: fh } = containSize(img, colW - 40, photoH - 40);
    ctx.drawImage(img, x + (colW - fw) / 2, topBarH + (photoH - fh) / 2, fw, fh);
  });

  ctx.fillStyle = DARK_GREEN;
  ctx.fillRect(0, 0, W, topBarH);
  ctx.fillStyle = ACCENT_GREEN;
  ctx.fillRect(0, topBarH - 6, W, 6);

  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "center";
  ctx.fillStyle = "#ffffff";
  ctx.font = `700 54px ${FONT}`;
  ctx.fillText(title || "", W / 2, 65);
  ctx.fillStyle = "rgb(200,220,208)";
  ctx.font = `400 30px ${FONT}`;
  ctx.fillText(subtitle || "", W / 2, 122);
  ctx.textAlign = "left";
}

/** A ready-made flyer/comunicado (own text baked in) shown whole on an
 * institutional green background, with an attention-grabbing headline added
 * on top so it doesn't blend into the rest of the playlist. */
export function renderAnnouncementSlide(canvas, img, headline) {
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");

  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, DARK_GREEN);
  grad.addColorStop(1, DARK_GREEN2);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  const maxH = H - 260;
  let targetH = maxH;
  let targetW = img.width * (targetH / img.height);
  if (targetW > 780) {
    targetW = 780;
    targetH = img.height * (targetW / img.width);
  }
  const cx = (W - targetW) / 2;
  const cy = 170 + (H - 170 - 90 - targetH) / 2;

  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.5)";
  ctx.shadowBlur = 35;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(cx, cy, targetW, targetH);
  ctx.restore();
  ctx.drawImage(img, cx, cy, targetW, targetH);

  drawLogoTag(ctx, 50, 40);

  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "center";
  ctx.fillStyle = ACCENT_GREEN;
  ctx.font = `700 58px ${FONT}`;
  ctx.fillText(headline || "", W / 2, 100);

  ctx.textAlign = "right";
  ctx.fillStyle = "rgb(220,230,224)";
  ctx.font = `400 26px ${FONT}`;
  ctx.fillText("Capital Humano", W - 50, H - 40);
  ctx.textAlign = "left";
}

/** Five bold "ráfaga" (sunburst) color themes for renderFlashySlide, cycled
 * automatically per publish so consecutive RH posts don't all look the same. */
export const FLASHY_PALETTES = [
  { bg: "#0b1710", rayA: "#0f2417", rayB: "#153a24", accent: "#22c55e", accent2: "#f4b942", glow: "rgba(34,197,94,.85)" },
  { bg: "#071b1a", rayA: "#0d2e2c", rayB: "#0f4442", accent: "#22d3ee", accent2: "#14b8a6", glow: "rgba(34,211,238,.85)" },
  { bg: "#170c1e", rayA: "#1c2a17", rayB: "#2a1224", accent: "#f472b6", accent2: "#22c55e", glow: "rgba(244,114,182,.85)" },
  { bg: "#1a1206", rayA: "#2b1e08", rayB: "#3d2a0a", accent: "#f4b942", accent2: "#22c55e", glow: "rgba(244,185,66,.85)" },
  { bg: "#05070d", rayA: "#0c0f1a", rayB: "#150a1c", accent: "#22c55e", accent2: "#ec4899", glow: "rgba(236,72,153,.85)" },
];

function drawSunburst(ctx, cx, cy, radius, colorA, colorB, wedgeDeg) {
  const step = (wedgeDeg * Math.PI) / 180;
  let angle = 0;
  let toggle = false;
  while (angle < Math.PI * 2) {
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, angle, angle + step);
    ctx.closePath();
    ctx.fillStyle = toggle ? colorB : colorA;
    ctx.fill();
    angle += step;
    toggle = !toggle;
  }
}

/** A second, sparser ring of thin accent-colored spokes overlaid on top of
 * the base sunburst (mirrors the counter-rotating accent layer from the
 * approved RH mockup) so the rays read as two-tone instead of flat. */
function drawSunburstAccent(ctx, cx, cy, radius, color, wedgeDeg, gapDeg, opacity, phaseDeg = 0) {
  const period = ((wedgeDeg + gapDeg) * Math.PI) / 180;
  const wedge = (wedgeDeg * Math.PI) / 180;
  const phase = (phaseDeg * Math.PI) / 180;
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.fillStyle = color;
  let angle = phase;
  while (angle < Math.PI * 2 + phase) {
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, angle, angle + wedge);
    ctx.closePath();
    ctx.fill();
    angle += period;
  }
  ctx.restore();
}

function drawDotGrid(ctx, x, y, size, spacing, color) {
  ctx.fillStyle = color;
  for (let dx = 0; dx < size; dx += spacing) {
    for (let dy = 0; dy < size; dy += spacing) {
      ctx.beginPath();
      ctx.arc(x + dx, y + dy, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** A photo/announcement framed by an animated-style "ráfaga" (sunburst)
 * background, matching the CaptaVision kiosco redesign's loud-but-office
 * visual language: rays + neon-outline headline + a clean white card
 * holding the actual photo, so the content stays legible over the noise. */
export function renderFlashySlide(canvas, img, headline, paletteIndex = 0) {
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  const p = FLASHY_PALETTES[paletteIndex % FLASHY_PALETTES.length];

  ctx.fillStyle = p.bg;
  ctx.fillRect(0, 0, W, H);

  const cx = W / 2;
  const cy = H * 0.54;
  drawSunburst(ctx, cx, cy, 2100, p.rayA, p.rayB, 9);
  drawSunburstAccent(ctx, cx, cy, 2100, p.accent, 3, 15, 0.28, 4);

  const vignette = ctx.createRadialGradient(cx, cy, H * 0.32, cx, cy, H * 0.95);
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(1, p.bg);
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, W, H);

  drawDotGrid(ctx, 44, 44, 84, 20, "rgba(244,185,66,.55)");
  drawDotGrid(ctx, W - 128, 44, 84, 20, "rgba(244,185,66,.55)");

  ctx.save();
  ctx.translate(150, 190);
  ctx.rotate(Math.PI / 4);
  ctx.fillStyle = p.accent2;
  ctx.fillRect(-13, -13, 26, 26);
  ctx.restore();
  ctx.fillStyle = p.accent;
  ctx.beginPath();
  ctx.arc(W - 190, 260, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = p.accent2;
  ctx.beginPath();
  ctx.arc(96, H - 264, 11, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.translate(W - 120, H - 216);
  ctx.rotate(Math.PI / 4);
  ctx.fillStyle = p.accent;
  ctx.fillRect(-13, -13, 26, 26);
  ctx.restore();

  // Neon-outline headline: dark stroke first for a poster-outline look,
  // then a soft accent-colored blur pass so it glows without washing out.
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.font = "900 40px Sora, Inter, sans-serif";
  ctx.lineWidth = 3;
  ctx.strokeStyle = p.bg;
  ctx.fillStyle = "#ffffff";
  ctx.shadowColor = p.glow;
  ctx.shadowBlur = 24;
  ctx.strokeText("CAPTAVALE · RECURSOS HUMANOS", cx, 88);
  ctx.fillText("CAPTAVALE · RECURSOS HUMANOS", cx, 88);

  ctx.font = "900 62px Sora, Inter, sans-serif";
  ctx.lineWidth = 4;
  ctx.strokeText(headline || "¡No te lo pierdas!", cx, 158);
  ctx.fillText(headline || "¡No te lo pierdas!", cx, 158);
  ctx.shadowBlur = 0;

  // Card holding the actual photo, sized/cropped the same way the plain
  // announcement mode does, so this mode is a drop-in visual upgrade.
  const cardW = 1240, cardH = 760;
  const cardX = cx - cardW / 2, cardY = 220;
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,.5)";
  ctx.shadowBlur = 50;
  ctx.fillStyle = "#f7f8f4";
  roundRect(ctx, cardX, cardY, cardW, cardH, 34);
  ctx.fill();
  ctx.restore();
  ctx.lineWidth = 7;
  ctx.strokeStyle = p.accent;
  roundRect(ctx, cardX, cardY, cardW, cardH, 34);
  ctx.stroke();

  const photoPad = 34;
  const photoX = cardX + photoPad, photoY = cardY + photoPad;
  const photoW = cardW - photoPad * 2, photoH = cardH - photoPad * 2;
  ctx.save();
  roundRect(ctx, photoX, photoY, photoW, photoH, 22);
  ctx.clip();
  drawCover(ctx, img, photoX, photoY, photoW, photoH);
  ctx.restore();

  const pillText = "Capital Humano";
  ctx.font = "700 26px Inter, sans-serif";
  const pillPadX = 34;
  const pillW = ctx.measureText(pillText).width + pillPadX * 2;
  const pillH = 56;
  const pillX = cx - pillW / 2;
  const pillY = cardY + cardH + 24;
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,.4)";
  ctx.shadowBlur = 18;
  ctx.fillStyle = "rgba(20,26,18,0.92)";
  roundRect(ctx, pillX, pillY, pillW, pillH, pillH / 2);
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(pillText, cx, pillY + pillH / 2 + 1);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

export function canvasToJpegBlob(canvas, quality = 0.9) {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}
