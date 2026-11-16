// dev-mock-result.js: sample data for checking result.html in a normal browser (?mock). Not used by the app.
(function () {
  function sample(label, c1, c2, w, h, mark) {
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const g = cv.getContext('2d');
    const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, c1); gr.addColorStop(1, c2); g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,0.85)'; g.font = 'bold ' + Math.round(h / 3) + 'px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(label, w / 2, h / 2);
    if (mark) { g.strokeStyle = '#ff6a5c'; g.lineWidth = 10; g.strokeRect(w * 0.3, h * 0.25, w * 0.4, h * 0.5); }
    return cv.toDataURL('image/png');
  }
  const imgs = [];
  const cols = [['#3a4250', '#c9b27a'], ['#4a3f36', '#d9a066'], ['#36463d', '#b7c48f'], ['#463a4a', '#c99ac2'], ['#3d4a4f', '#8fc1cf'], ['#4f4636', '#e0c36a'], ['#4a3636', '#d98a7a'], ['#363c4a', '#9aa8d9'], ['#3f4436', '#c4cf8f']];
  cols.forEach((c, i) => { const ed = i % 3 === 0; imgs.push({ orig: sample(String(i + 1), c[0], c[1], 1200, 800), edited: ed ? sample(String(i + 1), c[0], c[1], 1200, 800, true) : null, origPath: '/tmp/o' + i + '.png', editedPath: ed ? '/tmp/e' + i + '.png' : null }); });
  window.__mock = {
    initResult: {
      n: 3, v: 1, model: 'opus', effort: 'high', time: '2:14 PM',
      text: 'Product photo of a glass honey jar on a wooden kitchen table.\n\n**Subject:** the jar from *image 1*, keep its exact shape, lid and label.\n\n**Requirements:**\n1. Warm morning light from a window on the left\n2. Shallow depth of field\n   - jar sharp\n   - background softly blurred\n3. Natural colors, `no text`\n\n**Composition:** [SPECIFY: framing — close-up or wide?]',
      original: 'product photo of the jar on a kitchen table, warm morning light, use image 1 for the jar',
      changes: ['Split the draft into subject, lighting and composition', 'Named image 1 as the reference for the jar'], gaps: ['Should the shot be a close-up or a wide view?'],
      images: imgs
    },
    copyImages: true, copyText: true, saveText: true, setUseEdited: true, close: true,
    paste: { needsPermission: true }
  };
})();
