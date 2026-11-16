// dev-mock.js: sample data for checking the pages in a normal browser (?mock in the URL). Not used by the app.
(function () {
  function sample(label, c1, c2, w, h) {
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const g = cv.getContext('2d');
    const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, c1); gr.addColorStop(1, c2);
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,0.85)'; g.font = 'bold ' + Math.round(h / 3) + 'px sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(label, w / 2, h / 2);
    return cv.toDataURL('image/png');
  }
  window.__mock = {
    init: {
      wc: false,
      prompts: [
        { n: 3, v: 1, model: 'opus', effort: 'high', text: 'Fix the hero banner layout: the banner image overflows on screens under 400px wide' },
        { n: 2, v: 2, model: 'opus', effort: 'medium', text: 'Product photo of the jar on a kitchen table, warm morning light, shallow depth of field' },
        { n: 1, v: 1, model: 'sonnet', effort: 'medium', text: 'Write a short welcome message for new users, friendly and clear' }
      ],
      draft: null
    },
    pickImages: function () { return [{ src: sample('1', '#3a4250', '#c9b27a', 1600, 1000) }, { src: sample('2', '#4a3f36', '#d9a066', 900, 1200) }, { src: sample('3', '#36463d', '#b7c48f', 1200, 1200) }]; },
    clipboardImages: function () { return [{ src: sample('P', '#463a4a', '#c99ac2', 1280, 720) }]; },
    hit: null,
    dictationInfo: { whisper: true, mac: true, languages: ['en-MA', 'fr-MA'] },
    saveSettings: true, openLink: true, saveDraft: true,
    dictateStart: function () { setTimeout(() => window.__dictation({ text: 'hello', final: false }), 100); setTimeout(() => window.__dictation({ text: 'hello world', final: true }), 250); return { ok: true, mode: 'speech' }; },
    dictateStop: true,
    send: function (p) { window.__sent = p; return true; },
    cancel: function (p) { window.__cancelled = p; return true; }
  };
})();
