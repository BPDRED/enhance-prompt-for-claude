// editor.js: shape geometry and image export for the markup editor (shared by the popup).
// All shapes live in "doc space": the image scaled to fit 880 × 600, like the design board.
(function () {
  'use strict';
  const DOC_W = 880; const DOC_H = 600;
  const STROKE = 4;

  function fitDoc(nw, nh) {
    const s = Math.min(DOC_W / nw, DOC_H / nh);
    return { w: Math.round(nw * s * 100) / 100, h: Math.round(nh * s * 100) / 100, s: s };
  }
  function textBox(sh) {
    const size = sh.size || 24;
    return { x: sh.x, y: sh.y, w: Math.max(40, (sh.text || '').length * size * 0.6 + 12), h: Math.round(size * 1.42) };
  }
  function bbox(sh) {
    if (sh.type === 'rect' || sh.type === 'ellipse') return { x: sh.x, y: sh.y, w: sh.w, h: sh.h };
    if (sh.type === 'arrow') return { x: Math.min(sh.x1, sh.x2), y: Math.min(sh.y1, sh.y2), w: Math.abs(sh.x2 - sh.x1), h: Math.abs(sh.y2 - sh.y1) };
    if (sh.type === 'pen') {
      const xs = sh.pts.map((p) => p[0]); const ys = sh.pts.map((p) => p[1]);
      const x = Math.min.apply(null, xs); const y = Math.min.apply(null, ys);
      return { x: x, y: y, w: Math.max.apply(null, xs) - x, h: Math.max.apply(null, ys) - y };
    }
    return textBox(sh);
  }
  function center(sh) { const b = bbox(sh); return { x: b.x + b.w / 2, y: b.y + b.h / 2 }; }
  function shift(sh, dx, dy) {
    if (sh.type === 'arrow') return Object.assign({}, sh, { x1: sh.x1 + dx, y1: sh.y1 + dy, x2: sh.x2 + dx, y2: sh.y2 + dy });
    if (sh.type === 'pen') return Object.assign({}, sh, { pts: sh.pts.map((p) => [p[0] + dx, p[1] + dy]) });
    return Object.assign({}, sh, { x: sh.x + dx, y: sh.y + dy });
  }
  // Uniform scale around a fixed centre (cx, cy), from the shape as it was when the drag began.
  function scaleFrom(o, k, cx, cy) {
    const sx = (x) => cx + (x - cx) * k; const sy = (y) => cy + (y - cy) * k;
    if (o.type === 'text') {
      const size = Math.max(10, Math.min(220, Math.round((o.size || 24) * k)));
      const nb = textBox(Object.assign({}, o, { size: size }));
      return Object.assign({}, o, { size: size, x: cx - nb.w / 2, y: cy - nb.h / 2 });
    }
    if (o.type === 'rect' || o.type === 'ellipse') {
      const w = Math.max(6, o.w * k); const h = Math.max(6, o.h * k);
      return Object.assign({}, o, { x: cx - w / 2, y: cy - h / 2, w: w, h: h });
    }
    if (o.type === 'arrow') return Object.assign({}, o, { x1: sx(o.x1), y1: sy(o.y1), x2: sx(o.x2), y2: sy(o.y2) });
    if (o.type === 'pen') return Object.assign({}, o, { pts: o.pts.map((p) => [sx(p[0]), sy(p[1])]) });
    return o;
  }
  function hit(doc, p) {
    for (let i = doc.shapes.length - 1; i >= 0; i--) {
      const sh = doc.shapes[i];
      const b = bbox(sh);
      let lx = p.x; let ly = p.y;
      if (sh.rot) {
        // Turn the click point back by the shape's rotation, then test it against the upright box.
        const cx = b.x + b.w / 2; const cy = b.y + b.h / 2; const a = -sh.rot * Math.PI / 180;
        const dx = p.x - cx; const dy = p.y - cy;
        lx = cx + dx * Math.cos(a) - dy * Math.sin(a); ly = cy + dx * Math.sin(a) + dy * Math.cos(a);
      }
      if (lx >= b.x - 10 && lx <= b.x + b.w + 10 && ly >= b.y - 10 && ly <= b.y + b.h + 10) return sh;
    }
    return null;
  }
  function fromDraft(d) {
    const x = Math.min(d.x1, d.x2); const y = Math.min(d.y1, d.y2);
    const w = Math.abs(d.x2 - d.x1); const h = Math.abs(d.y2 - d.y1);
    if (d.type === 'rect' || d.type === 'ellipse' || d.type === 'crop') return { type: d.type, x: x, y: y, w: w, h: h };
    if (d.type === 'arrow') return { type: 'arrow', x1: d.x1, y1: d.y1, x2: d.x2, y2: d.y2 };
    return { type: 'pen', pts: d.pts };
  }
  function big(sh) {
    if (sh.type === 'pen') return sh.pts.length > 2;
    if (sh.type === 'arrow') return Math.hypot(sh.x2 - sh.x1, sh.y2 - sh.y1) > 10;
    return sh.w > 6 || sh.h > 6;
  }
  function head(x1, y1, x2, y2, sw) {
    const k = Math.max(0.6, (sw || STROKE) / STROKE);
    const a = Math.atan2(y2 - y1, x2 - x1); const L = 18 * Math.sqrt(k) + (sw || STROKE) * 0.8; const W = 9 * Math.sqrt(k) + (sw || STROKE) * 0.4;
    const bx = x2 - L * Math.cos(a); const by = y2 - L * Math.sin(a);
    return { lx: bx, ly: by, pts: [[x2, y2], [bx + W * Math.sin(a), by - W * Math.cos(a)], [bx - W * Math.sin(a), by + W * Math.cos(a)]],
      head: x2 + ',' + y2 + ' ' + (bx + W * Math.sin(a)) + ',' + (by - W * Math.cos(a)) + ' ' + (bx - W * Math.sin(a)) + ',' + (by + W * Math.cos(a)) };
  }
  function hasEdits(doc) { return !!(doc && (doc.crop || (doc.shapes && doc.shapes.length))); }

  // Draw the image with its crop and shapes onto a canvas at full resolution; returns a PNG data URL.
  function exportImage(img, doc, withEdits) {
    const f = img.naturalWidth / doc.w; // doc space → image pixels
    const c = withEdits && doc.crop ? doc.crop : { x: 0, y: 0, w: doc.w, h: doc.h };
    const cw = Math.max(1, Math.round(c.w * f)); const ch = Math.max(1, Math.round(c.h * f));
    const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
    const g = cv.getContext('2d');
    g.drawImage(img, c.x * f, c.y * f, c.w * f, c.h * f, 0, 0, cw, ch);
    if (withEdits) {
      g.save();
      g.scale(f, f); g.translate(-c.x, -c.y);
      g.lineCap = 'round'; g.lineJoin = 'round';
      for (const sh of doc.shapes) {
        const col = sh.c || '#ff6a5c';
        const ce = center(sh);
        g.save();
        if (sh.rot) { g.translate(ce.x, ce.y); g.rotate(sh.rot * Math.PI / 180); g.translate(-ce.x, -ce.y); }
        g.strokeStyle = col; g.fillStyle = col; g.lineWidth = sh.sw || STROKE;
        if (sh.type === 'rect') { roundRect(g, sh.x, sh.y, sh.w, sh.h, 6); g.stroke(); }
        else if (sh.type === 'ellipse') { g.beginPath(); g.ellipse(sh.x + sh.w / 2, sh.y + sh.h / 2, Math.max(0.5, sh.w / 2), Math.max(0.5, sh.h / 2), 0, 0, Math.PI * 2); g.stroke(); }
        else if (sh.type === 'arrow') {
          const hd = head(sh.x1, sh.y1, sh.x2, sh.y2, sh.sw);
          g.beginPath(); g.moveTo(sh.x1, sh.y1); g.lineTo(hd.lx, hd.ly); g.stroke();
          g.beginPath(); g.moveTo(hd.pts[0][0], hd.pts[0][1]); g.lineTo(hd.pts[1][0], hd.pts[1][1]); g.lineTo(hd.pts[2][0], hd.pts[2][1]); g.closePath(); g.fill();
        } else if (sh.type === 'pen') {
          g.beginPath(); sh.pts.forEach((p, i) => { if (i) g.lineTo(p[0], p[1]); else g.moveTo(p[0], p[1]); }); g.stroke();
        } else if (sh.type === 'text') {
          const b = textBox(sh);
          g.font = '600 ' + (sh.size || 24) + 'px -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif';
          g.textBaseline = 'middle';
          g.shadowColor = 'rgba(0,0,0,0.45)'; g.shadowBlur = 2; g.shadowOffsetY = 1;
          g.fillText(sh.text, b.x + 4, b.y + b.h / 2);
        }
        g.restore();
      }
      g.restore();
    }
    return cv.toDataURL('image/png');
  }
  function roundRect(g, x, y, w, h, r) {
    const rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
    g.beginPath();
    g.moveTo(x + rr, y); g.lineTo(x + w - rr, y); g.quadraticCurveTo(x + w, y, x + w, y + rr);
    g.lineTo(x + w, y + h - rr); g.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    g.lineTo(x + rr, y + h); g.quadraticCurveTo(x, y + h, x, y + h - rr);
    g.lineTo(x, y + rr); g.quadraticCurveTo(x, y, x + rr, y); g.closePath();
  }

  window.Markup = { DOC_W, DOC_H, STROKE, fitDoc, textBox, bbox, center, shift, scaleFrom, hit, fromDraft, big, head, hasEdits, exportImage };
})();
