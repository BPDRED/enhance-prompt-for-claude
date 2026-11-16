// popup.js: the /enhance-prompt input popup. Logic ported from the approved boards:
// 1 idle, 2–5 composer + revise bar/list, 6 image preview + markup editor.
(function () {
  'use strict';
  const M = window.Markup;
  const EASE = 'cubic-bezier(0.65, 0, 0.35, 1)';
  const ms = (n) => Math.round(n) + 'ms';
  let uid = 1;

  const ICONS = {
    select: '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M5 3l14 8-6 2-2 6z"></path></svg>',
    crop: '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2v14a2 2 0 0 0 2 2h14"></path><path d="M18 22V8a2 2 0 0 0-2-2H2"></path></svg>',
    rect: '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="5" width="16" height="14" rx="2"></rect></svg>',
    ellipse: '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="8"></circle></svg>',
    arrow: '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 19L19 5"></path><path d="M9 5h10v10"></path></svg>',
    pen: '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"></path></svg>',
    text: '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M5 6V4h14v2"></path><path d="M12 4v16"></path><path d="M9 20h6"></path></svg>'
  };
  const TOOLS_A = [['select', 'Select and move', 'V'], ['crop', 'Crop', 'C']];
  const TOOLS_B = [['rect', 'Rectangle', 'R'], ['ellipse', 'Circle', 'O'], ['arrow', 'Arrow', 'A'], ['pen', 'Pen', 'P'], ['text', 'Text', 'T']];
  const PRESETS = [
    { name: 'Red', hex: '#ff6a5c' }, { name: 'Orange', hex: '#ffa94d' }, { name: 'Yellow', hex: '#ffd43b' }, { name: 'Green', hex: '#51cf66' },
    { name: 'Blue', hex: '#4dabf7' }, { name: 'Purple', hex: '#b197fc' }, { name: 'White', hex: '#ffffff' }, { name: 'Black', hex: '#1a1a1a' }
  ];
  const HINTS = {
    select: 'Click a shape to select it · drag to move · corners resize and rotate · double-click text to edit',
    crop: 'Drag to choose the area · ✓ or Enter applies · ✕ or Esc cancels',
    rect: 'Drag to draw · shapes stay movable until you press Done',
    ellipse: 'Drag to draw · shapes stay movable until you press Done',
    arrow: 'Drag from start to tip · shapes stay movable until you press Done',
    pen: 'Draw freely · strokes stay movable until you press Done',
    text: 'Click to place text · Enter to finish'
  };
  const PH = 'Click to revise a previous prompt and change its #number';
  // Languages offered in dictation settings. w: Whisper supports it; m: Mac dictation.
  const LANGS = [
    ['en', 'English', 'wm'], ['fr', 'French', 'wm'], ['ar', 'Arabic', 'wm'], ['es', 'Spanish', 'wm'], ['de', 'German', 'wm'],
    ['it', 'Italian', 'wm'], ['pt', 'Portuguese', 'wm'], ['nl', 'Dutch', 'wm'], ['ru', 'Russian', 'wm'], ['uk', 'Ukrainian', 'wm'],
    ['pl', 'Polish', 'wm'], ['tr', 'Turkish', 'wm'], ['zh', 'Chinese', 'wm'], ['ja', 'Japanese', 'wm'], ['ko', 'Korean', 'wm'], ['hi', 'Hindi', 'wm']
  ];
  const ENGINES = [
    ['mac', 'Mac dictation', 'Apple\'s engine. Live text while you speak.'],
    ['whisper', 'Whisper Turbo', 'Very good, slower here (about 10–20 s). Most languages.']
  ];


  function shortText(t, nWords) {
    const w = String(t || '').replace(/\s+/g, ' ').trim().split(' ');
    const cut = w.slice(0, nWords).join(' ');
    return w.length > nWords ? cut + '…' : cut;
  }

  class Popup extends DCLogic {
    constructor() {
      super();
      this.prompts = [];   // [{n, v, text, model, effort}] newest first
      this.imgEls = {};    // id → HTMLImageElement (for export)
      this.lay = { spacerBottom: 0, fixedH: 300 };
      this._hit = '';
    }
    S() {
      const s = this.state || {};
      return {
        mode: s.mode || 'closed', idx: s.idx == null ? 0 : s.idx, prevIdx: s.prevIdx == null ? -1 : s.prevIdx,
        anim: !!s.anim, near: s.near || null, tip: s.tip || null, tool: s.tool || 'select', color: s.color || '#ff6a5c',
        docs: s.docs || [], past: s.past || [], future: s.future || [], sel: s.sel == null ? null : s.sel,
        draft: s.draft || null, drag: s.drag || null, xf: s.xf || null, pendingCrop: s.pendingCrop || null,
        editStart: s.editStart || null, editId: s.editId == null ? null : s.editId, editNew: !!s.editNew,
        editOrig: s.editOrig || null, nextId: s.nextId || 1,
        rv: s.rv || { on: false, open: false, n: 0, ctx: 'toggle', swap: false },
        wc: s.wc == null ? false : s.wc, dict: s.dict || 'off', micMenu: !!s.micMenu, micSettings: !!s.micSettings, msDrop: s.msDrop || null, msSearch: s.msSearch || {}, msQ: s.msQ || {}, idle: !!s.idle, hover: s.hover == null ? -1 : s.hover,
        toast: s.toast || null, tick: s.tick || 0, sending: !!s.sending, fadeIn: !!s.fadeIn, stroke: s.stroke || M.STROKE, textSize: s.textSize || 24
      };
    }

    // ---------- init / native ----------
    async init() {
      let st = null;
      try { st = await Native.call('init'); } catch (e) { st = null; }
      st = st || {};
      this.prompts = (st.prompts || []).slice().sort((a, b) => b.n - a.n);
      const patch = { wc: !!st.wc };
      if (this.prompts.length) patch.rv = { on: false, open: false, n: this.prompts[0].n, ctx: 'toggle', swap: false };
      const d = st.draft;
      if (d) {
        if (d.revise && this.prompts.some((p) => p.n === d.revise)) patch.rv = { on: true, open: false, n: d.revise, ctx: 'toggle', swap: false };
        if (typeof d.wc === 'boolean') patch.wc = d.wc;
      }
      this.setState(patch);
      this.settings = Object.assign({}, st.settings || {});
      try { this.dictInfo = await Native.call('dictationInfo'); } catch (e) { this.dictInfo = null; }
      this.dictInfo = this.dictInfo || { whisper: false, mac: true, languages: ['en'] };
      if (!this.settings.languages || !this.settings.languages.length) this.settings.languages = (this.dictInfo.languages || ['en']).map((x) => String(x).slice(0, 2).toLowerCase()).filter((x, i, a) => a.indexOf(x) === i);
      if (!this.settings.lang || this.settings.languages.indexOf(this.settings.lang) === -1) this.settings.lang = this.settings.languages[0] || 'en';
      if (!this.settings.engine || !this.dictInfo[this.settings.engine]) this.settings.engine = 'mac';
      this.setState({ tick: this.S().tick + 1 });
      if (d && d.text) this.setText(d.text);
      if (d && d.images && d.images.length) await this.addImages(d.images, true);
      if (st.prefill && !this.getText().trim()) this.setText(st.prefill);
      this.focusText();
    }
    focusText() {
      setTimeout(() => {
        const ed = this._ta; if (!ed) return;
        const sel = window.getSelection();
        const inside = sel.rangeCount && ed.contains(sel.getRangeAt(0).startContainer);
        ed.focus();
        if (!inside) RichEdit.caretToEnd(ed);
      }, 30);
    }
    // The prompt box holds formatted text; it is read and written as Markdown.
    getText() { return this._ta ? MD.htmlToMd(this._ta) : ''; }
    setText(md) { if (!this._ta) return; this._ta.innerHTML = MD.mdToHtml(md); this.syncEmpty(); this.updateTextBar(); }
    syncEmpty() { if (this._ta) this._ta.classList.toggle('is-empty', RichEdit.isEmpty(this._ta)); }
    updateTextBar() {
      const el = this._ta; const v = this._tth; if (!el || !v) return;
      const ch = el.clientHeight; const sh = el.scrollHeight;
      if (!ch || sh <= ch + 1) { v.style.display = 'none'; return; }
      v.style.display = 'block'; const hh = Math.max(24, ch * ch / sh); const y = (el.scrollTop / (sh - ch)) * (ch - hh);
      v.style.height = hh + 'px'; v.style.transform = 'translateY(' + y + 'px)';
    }
    updateListBar() {
      const el = this._list; const v = this._lth; if (!el || !v) return;
      const ch = el.clientHeight; const sh = el.scrollHeight;
      if (!ch || sh <= ch + 1) { v.style.display = 'none'; return; }
      v.style.display = 'block'; const hh = Math.max(24, ch * ch / sh); const y = (el.scrollTop / (sh - ch)) * (ch - hh);
      v.style.height = hh + 'px'; v.style.transform = 'translateY(' + y + 'px)';
    }
    listScroll() { this.updateListBar(); const h = this._lth; if (!h) return; h.setAttribute('data-active', '1'); clearTimeout(h.__t); h.__t = setTimeout(() => h.removeAttribute('data-active'), 900); }
    textScroll() { this.updateTextBar(); const h = this._tth; if (!h) return; h.setAttribute('data-active', '1'); clearTimeout(h.__t); h.__t = setTimeout(() => h.removeAttribute('data-active'), 900); }
    toast(text) {
      this._tid = (this._tid || 0) + 1; const id = this._tid;
      this.setState({ toast: { text: text, id: id } });
      clearTimeout(this._tt); this._tt = setTimeout(() => { if (this._tid === id) this.setState({ toast: null }); }, 2200);
    }

    // ---------- images ----------
    loadImg(src) {
      return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('load failed')); im.src = src; });
    }
    async addImages(list, restoring) {
      const s0 = this.S();
      const docs = s0.docs.slice();
      for (const it of list) {
        try {
          const im = await this.loadImg(it.src);
          const id = 'img' + (uid++);
          this.imgEls[id] = im;
          const f = M.fitDoc(im.naturalWidth, im.naturalHeight);
          const shapes = restoring && it.shapes ? it.shapes : [];
          docs.push({ id: id, src: it.src, path: it.path || null, nw: im.naturalWidth, nh: im.naturalHeight, w: f.w, h: f.h, shapes: shapes, crop: restoring && it.crop ? it.crop : null });
        } catch (e) { this.toast('Could not open one image'); }
      }
      let nextId = this.S().nextId;
      docs.forEach((d) => d.shapes.forEach((x) => { if (typeof x.id === 'number' && x.id >= nextId) nextId = x.id + 1; }));
      this.setState({ docs: docs, idle: false, nextId: nextId });
    }
    async pickImages() {
      const r = await Native.call('pickImages');
      if (r && r.length) this.addImages(r);
      this.focusText();
    }
    removeImage(i) {
      const s = this.S();
      if (s.mode === 'edit') return;
      const docs = s.docs.slice(); docs.splice(i, 1);
      const patch = { docs: docs, hover: -1 };
      if (s.mode === 'preview') { if (!docs.length) patch.mode = 'closed'; else patch.idx = Math.min(s.idx, docs.length - 1); patch.prevIdx = -1; patch.anim = false; }
      this.setState(patch);
    }
    onPaste(e) {
      if (this.S().dict === 'transcribing') { e.preventDefault(); return; }   // the box is locked while the words are written
      const cd = e.clipboardData;
      if (!cd) return;
      const types = Array.from(cd.types || []);
      const hasImg = types.indexOf('Files') !== -1 || types.some((t) => t.indexOf('image/') === 0);
      if (!hasImg) { RichEdit.pastePlain(e); this.autoGrow(); return; }
      e.preventDefault();
      if (Native.available) {
        Native.call('clipboardImages').then((r) => {
          if (r && r.length) this.addImages(r);
          else { const t = cd.getData && cd.getData('text/plain'); if (t) document.execCommand('insertText', false, t); }
        });
        return;
      }
      const files = Array.from(cd.files || []).filter((f) => f.type.indexOf('image/') === 0);
      this.readFiles(files);
    }
    readFiles(files) {
      Promise.all(files.map((f) => new Promise((res) => { const r = new FileReader(); r.onload = () => res({ src: r.result }); r.onerror = () => res(null); r.readAsDataURL(f); })))
        .then((list) => { const ok = list.filter(Boolean); if (ok.length) this.addImages(ok); });
    }

    // ---------- text ----------
    autoGrow() { this.syncEmpty(); this.updateTextBar(); }
    taKey(e) {
      // Enter adds a new line; ⌘Enter sends. Typing while dictating stops the dictation.
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.isComposing) { e.preventDefault(); this.send(); return; }
      if ((this.S().dict === 'on' || this.S().dict === 'system') && !e.metaKey && e.key.length === 1) this.stopDictation();
    }
    // ----- dictation (mic turns blue only while it really listens) -----
    async toggleDictation() {
      const s = this.S();
      if (s.dict === 'transcribing') return;
      if (s.dict !== 'off') { this.stopDictation(); return; }
      if (s.idle) { this.setState({ idle: false }); await new Promise((r) => setTimeout(r, 60)); }
      this.closeMenus();
      this.focusText();
      await new Promise((r) => setTimeout(r, 40));
      this.placeDictMarker();
      this._dictEngine = this.settings.engine;
      this.setState({ dict: 'starting' });
      // Keep a copy of the draft first: if macOS stops the popup while asking for mic access, nothing is lost.
      try { const p = this.payload(false); const s0 = this.S(); p.images.forEach((x, i) => { const d = s0.docs[i]; if (!d.path && this.imgEls[d.id]) x.data = M.exportImage(this.imgEls[d.id], d, false); }); await Native.call('saveDraft', p); } catch (e) {}
      let r = null;
      try { r = await Native.call('dictateStart', { engine: this.settings.engine, lang: this.settings.lang }); } catch (e) { r = { ok: false, message: e.message }; }
      if (r && r.ok) { this.setState({ dict: r.mode === 'system' ? 'system' : (r.mode === 'record' ? 'rec' : 'on') }); }
      else { this.setState({ dict: 'off' }); this.finishDictMarker(); this.toast((r && r.message) || 'Dictation could not start'); }
    }
    stopDictation() {
      const d = this.S().dict;
      if (d === 'off' || d === 'transcribing') return;
      // Recording engines write the text after you stop; live engines are already done.
      if (d === 'rec' && this._marker) this._marker.setAttribute('data-wave', 'wait');
      if (d === 'rec') this.busyGuard();
      this.setState({ dict: d === 'rec' ? 'transcribing' : 'off' });
      if (d !== 'rec') this.finishDictMarker();
      Native.call('dictateStop');
    }
    // The box is locked while Whisper writes; never leave it locked if no answer comes.
    busyGuard() {
      clearTimeout(this._busyT);
      this._busyT = setTimeout(() => {
        if (this.S().dict !== 'transcribing') return;
        this.finishDictMarker(); this.setState({ dict: 'off' }); this.focusText();
        this.toast('Dictation took too long; nothing was written');
      }, 120000);
    }
    // Dictated words go into a marker placed at the caret, so they land where you were typing.
    placeDictMarker() {
      const ed = this._ta; if (!ed) return;
      this.finishDictMarker();
      const sel = window.getSelection();
      let r = sel.rangeCount && ed.contains(sel.getRangeAt(0).startContainer) ? sel.getRangeAt(0) : null;
      if (!r) { RichEdit.caretToEnd(ed); r = sel.getRangeAt(0); }
      r.deleteContents();
      const m = document.createElement('span'); m.setAttribute('data-dict', '1'); m.setAttribute('data-wave', this.settings.engine === 'mac' ? 'mac' : 'rec');
      r.insertNode(m);
      const pre = document.createRange(); pre.setStart(ed, 0); pre.setEndBefore(m);
      this._dictSpace = /\S$/.test(pre.toString());
      this._marker = m;
    }
    finishDictMarker() {
      const m = this._marker; this._marker = null;
      if (!m || !m.parentNode) return;
      const t = document.createTextNode(m.textContent);
      m.parentNode.replaceChild(t, m);
      const r = document.createRange(); r.setStartAfter(t); r.collapse(true);
      const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
      this.syncEmpty(); this.updateTextBar();
    }
    onDictation(m) {
      if (m.state === 'transcribing') { if (this._marker) this._marker.setAttribute('data-wave', 'wait'); if (this.S().dict !== 'off') { this.busyGuard(); this.setState({ dict: 'transcribing' }); } return; }
      if (m.error) { this.toast(m.error); }
      if (m.text != null && this._marker && this.S().dict !== 'off') {
        this._marker.textContent = (this._dictSpace && m.text ? ' ' : '') + m.text;
        this.syncEmpty(); this.updateTextBar();
      }
      if (m.done) { clearTimeout(this._busyT); this.finishDictMarker(); if (this.S().dict !== 'off') { this.setState({ dict: 'off' }); this.focusText(); } }
    }
    // ----- mic: click = start/stop, long-press = language menu -----
    micDown(e) {
      if (e.button !== 0) return;
      clearTimeout(this._lp); this._lpFired = false; this._lpDown = true;
      this._lp = setTimeout(() => { this._lpFired = true; const s0 = this.S(); if (s0.micMenu || s0.micSettings) this.closeMenus(); else this.setState({ micMenu: true, micSettings: false }); }, 450);
    }
    micUp() {
      if (!this._lpDown) return;
      this._lpDown = false; clearTimeout(this._lp);
      if (!this._lpFired) { if (this.S().micMenu || this.S().micSettings) this.closeMenus(); else this.toggleDictation(); }
    }
    micLeave() { if (this._lpDown && !this._lpFired) { this._lpDown = false; clearTimeout(this._lp); } }
    micKey(e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.toggleDictation(); } else if (e.key === 'ArrowUp') { e.preventDefault(); this.setState({ micMenu: true }); } }
    closeMenus() { if (this.S().micMenu || this.S().micSettings) this.setState({ micMenu: false, micSettings: false, msDrop: null, msSearch: {}, msQ: {} }); }
    msShowBar(key) {
      this.msUpdateBars();
      const th = this['_msth_' + key]; if (!th) return;
      th.setAttribute('data-active', '1');
      clearTimeout(th.__hideT);
      th.__hideT = setTimeout(() => th.removeAttribute('data-active'), 900);
    }
    msUpdateBars() {
      ['model', 'lang'].forEach((key) => {
        const el = this['_msl_' + key]; const th = this['_msth_' + key];
        if (!el || !th) return;
        const ch = el.clientHeight; const sh = el.scrollHeight;
        if (!ch || sh <= ch + 1) { th.style.display = 'none'; return; }
        th.style.display = 'block';
        const hh = Math.max(24, (ch - 8) * ch / sh);
        const y = 4 + (el.scrollTop / (sh - ch)) * (ch - 8 - hh);
        th.style.height = hh + 'px'; th.style.transform = 'translateY(' + y + 'px)';
      });
    }
    msBarsSoon() { clearTimeout(this._msBarsT); this._msBarsT = setTimeout(() => this.msUpdateBars(), 30); }
    // Handle at the top: hold and drag to move the box anywhere on the screen (the window covers the screen).
    // Handle at the top: hold and drag to move the box anywhere on the screen (the window covers the screen).
    // While dragging, the box, the open image preview and its controls slide together as one piece
    // (a GPU move, no re-render and no animation), so the preview never lags behind the box.
    handleDown(e) {
      if (e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();
      const el = e.currentTarget; el.setAttribute('data-active', '1');
      const g0 = this.view(this.S()).g; const sx = e.clientX; const sy = e.clientY;
      const parts = () => [this._box, document.querySelector('div[role="img"]'), document.querySelector('[data-pvchrome]')].filter(Boolean);
      document.documentElement.classList.add('resizing');   // no transitions while dragging
      let dx = 0; let dy = 0; let raf = 0;
      const move = (ev) => {
        dx = Math.max(8 - g0.CX, Math.min(g0.W - g0.BW - 8 - g0.CX, ev.clientX - sx));
        dy = Math.max(8 - g0.BB, Math.min(g0.maxBB - g0.BB, sy - ev.clientY));   // up is positive
        if (!raf) raf = requestAnimationFrame(() => { raf = 0; parts().forEach((p) => { p.style.translate = dx + 'px ' + (-dy) + 'px'; }); });
      };
      const up = () => {
        el.removeAttribute('data-active');
        window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('blur', up);
        cancelAnimationFrame(raf); raf = 0;
        this.boxOff = { x: g0.CX + dx - g0.CX0, y: g0.BB + dy - g0.B0 };
        parts().forEach((p) => { p.style.translate = ''; });
        this.setState({ tick: this.S().tick + 1 });   // the real place, drawn in the same spot: nothing jumps
        setTimeout(() => document.documentElement.classList.remove('resizing'), 80);
      };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('blur', up);
    }
    saveSettings() { Native.call('saveSettings', this.settings); this.setState({ tick: this.S().tick + 1 }); }
    langName(c) { const l = LANGS.find((x) => x[0] === c); return l ? l[1] : c.toUpperCase(); }
    langOk(c, engine) { const l = LANGS.find((x) => x[0] === c); return !l || l[2].indexOf(engine[0]) !== -1; }

    // ---------- send / cancel ----------
    payload(withExports) {
      const s = this.S();
      const images = s.docs.map((d) => {
        const im = this.imgEls[d.id];
        const out = { path: d.path || null, nw: d.nw, nh: d.nh, shapes: d.shapes, crop: d.crop, src: d.path ? null : d.src };
        if (withExports && im) {
          if (!d.path) out.data = M.exportImage(im, d, false);
          out.edited = M.hasEdits(d) ? M.exportImage(im, d, true) : null;
        }
        return out;
      });
      return { text: this.getText(), wc: s.wc, revise: s.rv.on ? s.rv.n : null, images: images };
    }
    async send() {
      const s = this.S();
      if (s.sending) return;
      // If you are still dictating, finish writing your words first, then send.
      if (s.dict === 'rec' || s.dict === 'transcribing' || s.dict === 'starting') {
        this.stopDictation(); this.toast('Writing your dictation, then sending…');
        const t0 = Date.now();
        while (this.S().dict !== 'off' && Date.now() - t0 < 90000) await new Promise((r) => setTimeout(r, 200));
      } else this.stopDictation();
      if (s.mode === 'edit') { this.toast('Press Done to finish editing first'); return; }
      const text = this.getText().trim();
      if (!text) { this.toast(s.rv.on ? 'Type what should change in #' + s.rv.n : 'Type a prompt first'); this.focusText(); return; }
      this.setState({ sending: true });
      try { await Native.call('send', this.payload(true)); }
      catch (e) { this.setState({ sending: false }); this.toast('Could not send: ' + e.message); }
    }
    cancel() {
      this.stopDictation();
      const p = this.payload(false);
      // Images that only exist in memory (pasted/dropped) are exported so the draft can be restored.
      const s = this.S();
      p.images.forEach((x, i) => { const d = s.docs[i]; if (!d.path && this.imgEls[d.id]) x.data = M.exportImage(this.imgEls[d.id], d, false); });
      Native.call('cancel', p);
    }

    // ---------- revise bar + list ----------
    toggleRevise() {
      const s = this.S();
      if (!this.prompts.length || s.rv.open) return;
      this.setState({ rv: Object.assign({}, s.rv, { on: !s.rv.on, ctx: 'toggle' }) });
    }
    slotClick(e) {
      if (e) e.stopPropagation();
      const s = this.S();
      if (!s.rv.on) { this.toggleRevise(); return; }
      if (s.rv.open) return;
      const open = () => this.setState({ rv: Object.assign({}, this.S().rv, { open: true, ctx: 'list' }) });
      // Opening the list closes an open image preview first, then opens.
      if (s.mode === 'preview') { this.closePv(); setTimeout(open, 400); }
      else open();
    }
    closeList(e) {
      if (e) e.stopPropagation();
      this.setState({ rv: Object.assign({}, this.S().rv, { open: false, ctx: 'list' }) });
    }
    pickRow(n) {
      const s = this.S();
      if (n === s.rv.n) return;
      this.setState({ rv: Object.assign({}, s.rv, { n: n, swap: true }) });
      setTimeout(() => this.setState({ rv: Object.assign({}, this.S().rv, { swap: false }) }), 40);
    }
    barKey(e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.toggleRevise(); } }

    // ---------- preview / editor (board 6) ----------
    setDoc(s, doc, extra) { const docs = s.docs.slice(); docs[s.idx] = doc; this.setState(Object.assign({ docs: docs }, extra || {})); }
    commit(s, doc, extra) { this.setDoc(s, doc, Object.assign({ past: s.past.concat([s.docs[s.idx]]), future: [] }, extra || {})); }
    geo() {
      const W = window.innerWidth; const H = window.innerHeight;
      const BW = Math.min(780, W - 40);
      // The window covers the screen; the box sits where the old 820px-high popup had it, moved by the handle.
      const off = this.boxOff || { x: 0, y: 0 };
      const B0 = Math.max(40, Math.round((H - 820) / 2) + 40);
      const CX = Math.max(8, Math.min(W - BW - 8, Math.round((W - BW) / 2) + off.x));
      const BB = B0 + off.y;   // wanted place; view() keeps the box (and what opens above it) on screen
      const edX = W >= 1000 ? 200 : 60; const edW = W - edX * 2; const edH = Math.max(200, H - 200);
      return { W: W, H: H, BW: BW, CX: CX, BB: BB, CX0: Math.round((W - BW) / 2), B0: B0, IW: BW - 32, edX: edX, edY: 96, edW: edW, edH: edH };
    }
    view(s) {
      const g = this.geo();
      const doc = s.docs[s.idx] || { w: M.DOC_W, h: M.DOC_H, crop: null };
      const c = doc.crop || { x: 0, y: 0, w: doc.w, h: doc.h };
      const es = Math.min(g.edW / c.w, g.edH / c.h);
      const maxPh = Math.max(120, Math.min(510, g.H - 8 - this.lay.fixedH - 24 - 14));
      // The preview always uses the full width of the box; its height follows the image up to a limit,
      // and a tall image sits centred inside it.
      const pw = g.IW; const ph = Math.min(maxPh, c.h * g.IW / c.w);
      const ps = Math.min(g.IW / c.w, ph / c.h);
      // Where the box ends up (not where it is halfway through an animation), so the image, the box
      // and the backdrop all aim at the same place and move together.
      const open = s.mode !== 'closed' && s.docs.length;
      const needH = this.lay.fixedH + (open ? ph + 14 : 0) + ((s.micMenu || s.micSettings) ? 220 : 0) + 12;
      g.maxBB = Math.max(8, g.H - needH);
      g.BB = Math.max(8, Math.min(g.maxBB, g.BB));
      const bottom = this.lay.belowSp ? g.H - g.BB - this.lay.belowSp : (this.lay.spacerBottom || (g.H - 200));
      return {
        g: g, c: c,
        ed: { s: es, x: g.edX + (g.edW - c.w * es) / 2, y: g.edY + (g.edH - c.h * es) / 2 },
        pv: { s: ps, x: g.CX + 17, y: bottom - 14 - ph, w: pw, h: ph },
        box: { w: pw / ps, h: ph / ps }
      };
    }
    pt(e) {
      const c = this.view(this.S()).c;
      const r = e.currentTarget.getBoundingClientRect();
      const x = c.x + (e.clientX - r.left) * c.w / r.width;
      const y = c.y + (e.clientY - r.top) * c.h / r.height;
      return { x: Math.max(c.x, Math.min(c.x + c.w, x)), y: Math.max(c.y, Math.min(c.y + c.h, y)) };
    }
    startEdit(s, sh) { this.setState({ editId: sh.id, editNew: false, editOrig: s.docs[s.idx], sel: sh.id }); }
    endEdit() {
      const s = this.S();
      if (s.editId == null) return;
      const doc = s.docs[s.idx];
      const sh = doc.shapes.find((x) => x.id === s.editId);
      const reset = { editId: null, editNew: false, editOrig: null };
      if (!sh || !sh.text.trim()) {
        if (s.editNew && s.past.length) {
          const docs = s.docs.slice(); docs[s.idx] = s.past[s.past.length - 1];
          this.setState(Object.assign({ docs: docs, past: s.past.slice(0, -1), sel: null }, reset));
        } else {
          this.commit(s, Object.assign({}, doc, { shapes: doc.shapes.filter((x) => x.id !== s.editId) }), Object.assign({ sel: null }, reset));
        }
        return;
      }
      if (!s.editNew && s.editOrig && s.editOrig !== doc) { this.setState(Object.assign({ past: s.past.concat([s.editOrig]), future: [] }, reset)); return; }
      this.setState(reset);
    }
    // Crops and image switches change the box at once (no sliding or morphing), then fade in quickly.
    snap(fade) {
      this._snap = true; clearTimeout(this._snapT);
      this._snapT = setTimeout(() => { this._snap = false; if (fade) this.setState({ fadeIn: false }); else this.setState({ tick: this.S().tick + 1 }); }, 40);
      if (fade) this.setState({ fadeIn: true });
    }
    undo() {
      const s = this.S();
      if (s.editId != null || !s.past.length) return;
      const docs = s.docs.slice(); docs[s.idx] = s.past[s.past.length - 1];
      if (docs[s.idx].crop !== s.docs[s.idx].crop) this.snap(true);
      this.setState({ docs: docs, past: s.past.slice(0, -1), future: [s.docs[s.idx]].concat(s.future), sel: null });
    }
    redo() {
      const s = this.S();
      if (s.editId != null || !s.future.length) return;
      const docs = s.docs.slice(); docs[s.idx] = s.future[0];
      if (docs[s.idx].crop !== s.docs[s.idx].crop) this.snap(true);
      this.setState({ docs: docs, future: s.future.slice(1), past: s.past.concat([s.docs[s.idx]]), sel: null });
    }
    delSel() {
      const s = this.S();
      if (s.sel == null) return;
      const doc = s.docs[s.idx];
      this.commit(s, Object.assign({}, doc, { shapes: doc.shapes.filter((x) => x.id !== s.sel) }), { sel: null, tip: null });
    }
    pick(i) {
      const s = this.S();
      if (s.mode === 'edit') return;
      if (s.rv.open) {
        // The list and the preview never show together: close the list, then open the image.
        this.closeList();
        setTimeout(() => this.setState({ mode: 'preview', idx: i, prevIdx: -1, anim: false, tip: null }), 650);
        return;
      }
      if (s.mode === 'closed') this.setState({ mode: 'preview', idx: i, prevIdx: -1, anim: false, tip: null });
      else if (i === s.idx) this.closePv();
      else { this.snap(false); this.setState({ idx: i, prevIdx: s.idx, anim: true }); clearTimeout(this._animEnd); this._animEnd = setTimeout(() => this.setState({ anim: false }), 220); }
    }
    go(d) {
      const s = this.S();
      if (s.mode !== 'preview') return;
      const i = Math.max(0, Math.min(s.docs.length - 1, s.idx + d));
      if (i !== s.idx) { this.snap(false); this.setState({ idx: i, prevIdx: s.idx, anim: true }); clearTimeout(this._animEnd); this._animEnd = setTimeout(() => this.setState({ anim: false }), 220); }
    }
    closePv() { this.setState({ mode: 'closed', near: null, tip: null }); }
    enterEdit() { const s = this.S(); this.setState({ mode: 'edit', editStart: s.docs[s.idx], past: [], future: [], sel: null, draft: null, drag: null, pendingCrop: null, tip: null, near: null }); }
    done() {
      if (this.S().editId != null) this.endEdit();
      this.setState({ mode: 'preview', sel: null, draft: null, drag: null, pendingCrop: null, tip: null, anim: false });
    }
    discard() {
      const s = this.S();
      const docs = s.docs.slice();
      if (s.editStart) docs[s.idx] = s.editStart;
      if (docs[s.idx].crop !== s.docs[s.idx].crop) this.snap(true);
      this.setState({ docs: docs, mode: 'preview', past: [], future: [], sel: null, draft: null, drag: null, xf: null, editId: null, editNew: false, editOrig: null, pendingCrop: null, tip: null, anim: false });
    }
    applyCrop() { const s = this.S(); if (!s.pendingCrop) return; this.snap(true); this.commit(s, Object.assign({}, s.docs[s.idx], { crop: s.pendingCrop }), { pendingCrop: null, tip: null }); }
    cancelCrop() { this.setState({ pendingCrop: null, tip: null }); }
    setColor(hex) {
      const s = this.S();
      if (s.mode === 'edit' && s.sel != null) {
        const doc = s.docs[s.idx];
        this.commit(s, Object.assign({}, doc, { shapes: doc.shapes.map((x) => x.id === s.sel ? Object.assign({}, x, { c: hex }) : x) }), { color: hex });
        return;
      }
      this.setState({ color: hex });
    }
    // Thickness / text-size wedge (shown under the colours). Lines: 1–16 px; text: 10–120.
    wedgeMode(s) {
      const doc = s.docs[s.idx];
      const sh = doc && s.sel != null ? doc.shapes.find((x) => x.id === s.sel) : null;
      const text = sh ? sh.type === 'text' : s.tool === 'text';
      return text ? { text: true, min: 10, max: 120 } : { text: false, min: 1, max: 16 };
    }
    wedgeValue(s) {
      const doc = s.docs[s.idx];
      const sh = doc && s.sel != null ? doc.shapes.find((x) => x.id === s.sel) : null;
      if (sh) return sh.type === 'text' ? (sh.size || 24) : (sh.sw || M.STROKE);
      return s.tool === 'text' ? s.textSize : s.stroke;
    }
    setWedge(v) {
      // Sets the value for new shapes, and changes the selected shape (one undo step per drag).
      const s = this.S(); const wm = this.wedgeMode(s);
      v = Math.max(wm.min, Math.min(wm.max, Math.round(v)));
      const patch = wm.text ? { textSize: v } : { stroke: v };
      if (s.mode === 'edit' && s.sel != null) {
        const doc = s.docs[s.idx];
        const sh = doc.shapes.find((x) => x.id === s.sel);
        if (sh) {
          if (!this._swBase) this._swBase = doc;
          clearTimeout(this._swT); this._swT = setTimeout(() => { if (!this._wgDrag) this._swBase = null; }, 600);
          let next;
          if (sh.type === 'text') { const ce = M.center(sh); next = M.scaleFrom(sh, v / (sh.size || 24), ce.x, ce.y); next.size = v; const nb = M.textBox(next); next.x = ce.x - nb.w / 2; next.y = ce.y - nb.h / 2; }
          else next = Object.assign({}, sh, { sw: v });
          const docs = s.docs.slice();
          docs[s.idx] = Object.assign({}, doc, { shapes: doc.shapes.map((x) => x.id === s.sel ? next : x) });
          if (this._swBase === doc && !(s.past.length && s.past[s.past.length - 1] === doc)) Object.assign(patch, { past: s.past.concat([doc]), future: [] });
          patch.docs = docs;
        }
      }
      this.setState(patch);
    }
    wgAt(e) {
      const r = e.currentTarget.getBoundingClientRect(); const wm = this.wedgeMode(this.S());
      const f = Math.max(0, Math.min(1, (e.clientX - r.left - 7) / (r.width - 14)));
      this.setWedge(wm.min + f * (wm.max - wm.min));
    }
    wgDown(e) { e.preventDefault(); this._wgDrag = true; this._swBase = null; try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) {} this.wgAt(e); }
    wgMove(e) { if (this._wgDrag) this.wgAt(e); }
    wgKey(e) {
      const d = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0;
      if (!d) return; e.preventDefault(); e.stopPropagation();
      const s = this.S(); this.setWedge(this.wedgeValue(s) + d * (this.wedgeMode(s).text ? 2 : 1));
    }
    setTool(t) { if (this.S().editId != null) this.endEdit(); this.setState({ tool: t, sel: null, pendingCrop: null }); }
    mdown(e) {
      const s = this.S();
      if (s.mode !== 'edit') return;
      if (e.target && e.target.tagName === 'INPUT') return;
      e.preventDefault();
      if (s.editId == null && this._root) this._root.focus();
    }
    focusEdit(el) {
      if (!el) return;
      setTimeout(() => { if (document.activeElement !== el) { el.focus(); const n = el.value.length; try { el.setSelectionRange(n, n); } catch (err) {} } }, 0);
    }
    down(e) {
      const s = this.S();
      if (s.mode !== 'edit' || s.editId != null) return;
      if (e.target && e.target.tagName === 'INPUT') return;
      if (e.target && e.target.closest && e.target.closest('[data-cropbtn]')) return;
      const p = this.pt(e);
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) {}
      const doc = s.docs[s.idx];
      const hnd = e.target && e.target.getAttribute ? e.target.getAttribute('data-handle') : null;
      if (hnd && s.sel != null) {
        const sh = doc.shapes.find((x) => x.id === s.sel);
        if (sh) {
          const ce = M.center(sh);
          this.setState({ xf: { kind: hnd, id: sh.id, orig: doc, shape0: sh, cx: ce.x, cy: ce.y, d0: Math.max(8, Math.hypot(p.x - ce.x, p.y - ce.y)), a0: Math.atan2(p.y - ce.y, p.x - ce.x) * 180 / Math.PI, rot0: sh.rot || 0, moved: false } });
          return;
        }
      }
      if (s.tool === 'select') {
        const h = M.hit(doc, p);
        this.setState(h ? { sel: h.id, drag: { id: h.id, sx: p.x, sy: p.y, orig: doc, moved: false } } : { sel: null });
        return;
      }
      if (s.tool === 'text') {
        const h = M.hit(doc, p);
        if (h && h.type === 'text') { this.startEdit(s, h); return; }
        const id = s.nextId;
        const sh = { id: id, type: 'text', x: p.x, y: p.y - Math.round(s.textSize * 0.71), text: '', c: s.color, size: s.textSize };
        this.commit(s, Object.assign({}, doc, { shapes: doc.shapes.concat([sh]) }), { nextId: id + 1, editId: id, editNew: true, sel: id });
        return;
      }
      this.setState({ draft: { type: s.tool, x1: p.x, y1: p.y, x2: p.x, y2: p.y, pts: [[p.x, p.y]] }, sel: null, pendingCrop: null });
    }
    move(e) {
      const s = this.S();
      if (s.xf) {
        const p = this.pt(e); const xf = s.xf; const o = xf.orig;
        const doc = Object.assign({}, o, { shapes: o.shapes.map((x) => {
          if (x.id !== xf.id) return x;
          if (xf.kind === 'rotate') {
            let deg = xf.rot0 + (Math.atan2(p.y - xf.cy, p.x - xf.cx) * 180 / Math.PI - xf.a0);
            deg = ((deg % 360) + 360) % 360;
            const snap = Math.round(deg / 15) * 15;
            if (Math.abs(deg - snap) < 4) deg = snap;
            if (deg > 180) deg -= 360;
            return Object.assign({}, x, { rot: Math.round(deg * 10) / 10 });
          }
          // Resize from any corner: the shape grows or shrinks around its centre, rotation stays.
          const k = Math.max(0.1, Math.min(12, Math.hypot(p.x - xf.cx, p.y - xf.cy) / xf.d0));
          return M.scaleFrom(xf.shape0, k, xf.cx, xf.cy);
        }) });
        this.setDoc(s, doc, { xf: Object.assign({}, xf, { moved: true }) });
        return;
      }
      if (s.drag) {
        const p = this.pt(e);
        const dx = p.x - s.drag.sx; const dy = p.y - s.drag.sy; const o = s.drag.orig;
        const doc = Object.assign({}, o, { shapes: o.shapes.map((x) => x.id === s.drag.id ? M.shift(x, dx, dy) : x) });
        this.setDoc(s, doc, { drag: Object.assign({}, s.drag, { moved: true }) });
        return;
      }
      if (s.draft) {
        const p = this.pt(e);
        const d = Object.assign({}, s.draft, { x2: p.x, y2: p.y });
        if (d.type === 'pen') d.pts = s.draft.pts.concat([[p.x, p.y]]);
        this.setState({ draft: d });
      }
    }
    up() {
      const s = this.S();
      if (s.xf) { this.setState(s.xf.moved ? { xf: null, past: s.past.concat([s.xf.orig]), future: [] } : { xf: null }); return; }
      if (s.drag) { this.setState(s.drag.moved ? { drag: null, past: s.past.concat([s.drag.orig]), future: [] } : { drag: null }); return; }
      if (s.draft) {
        const sh = M.fromDraft(s.draft);
        const doc = s.docs[s.idx];
        if (!M.big(sh)) { this.setState({ draft: null }); return; }
        if (sh.type === 'crop') { this.setState({ draft: null, pendingCrop: { x: sh.x, y: sh.y, w: sh.w, h: sh.h } }); return; }
        const id = s.nextId;
        this.commit(s, Object.assign({}, doc, { shapes: doc.shapes.concat([Object.assign({ id: id, c: s.color, sw: s.stroke }, sh)]) }), { draft: null, nextId: id + 1, sel: id });
      }
    }
    dbl(e) {
      const s = this.S();
      if (s.mode !== 'edit' || s.tool !== 'select') return;
      const h = M.hit(s.docs[s.idx], this.pt(e));
      if (h && h.type === 'text') this.startEdit(s, h);
    }
    onEditInput(e) {
      const s = this.S(); const v = e.target.value; const doc = s.docs[s.idx];
      this.setDoc(s, Object.assign({}, doc, { shapes: doc.shapes.map((x) => x.id === s.editId ? Object.assign({}, x, { text: v }) : x) }));
    }
    onKey(e) {
      const s = this.S();
      const k = e.key; const mod = e.metaKey || e.ctrlKey;
      if (k === 'Escape' && (s.micMenu || s.micSettings)) { e.preventDefault(); this.closeMenus(); return; }
      const tag = e.target && e.target.tagName;
      if (tag === 'INPUT' && e.target.type !== 'color') {
        if (k === 'Enter' || k === 'Escape') { e.preventDefault(); this.endEdit(); }
        return;
      }
      if (mod && (k === 'w' || k === 'W')) { e.preventDefault(); this.cancel(); return; }
      if (e.target && e.target.isContentEditable) {
        if (k === 'Escape') { e.preventDefault(); if (s.mode === 'preview') this.closePv(); else if (s.mode === 'closed') this.cancel(); }
        return;
      }
      if (s.mode === 'closed') {
        if (k === 'Escape') { e.preventDefault(); this.cancel(); }
        else if (k === 'Enter' && mod) { e.preventDefault(); this.send(); }
        return;
      }
      if (s.mode === 'preview') {
        if (k === 'ArrowLeft') { e.preventDefault(); this.go(-1); }
        else if (k === 'ArrowRight') { e.preventDefault(); this.go(1); }
        else if (k === 'e' || k === 'E') { e.preventDefault(); this.enterEdit(); }
        else if (k === 'Escape') { e.preventDefault(); this.closePv(); }
        else if (k === 'Enter' && mod) { e.preventDefault(); this.send(); }
        return;
      }
      if (mod && (k === 'z' || k === 'Z')) { e.preventDefault(); if (e.shiftKey) this.redo(); else this.undo(); return; }
      if (mod) return;
      const tools = { v: 'select', c: 'crop', r: 'rect', o: 'ellipse', a: 'arrow', p: 'pen', t: 'text' };
      const lk = k.toLowerCase();
      if (tools[lk]) { e.preventDefault(); this.setTool(tools[lk]); return; }
      if (k === 'Backspace' || k === 'Delete') { e.preventDefault(); this.delSel(); return; }
      if (k === 'Enter' && s.pendingCrop) { e.preventDefault(); this.applyCrop(); return; }
      if (k === 'Enter' || lk === 'e') { e.preventDefault(); this.done(); return; }
      if (k === 'Escape') { e.preventDefault(); if (s.pendingCrop) this.cancelCrop(); else if (s.sel != null || s.draft) this.setState({ sel: null, draft: null }); }
    }

    // ---------- strip scroll bar ----------
    updateBar() {
      const st = this._strip; const h = this._hth;
      if (!st || !h) return;
      const cw = st.clientWidth; const sw = st.scrollWidth;
      if (sw <= cw + 1) { h.style.display = 'none'; return; }
      h.style.display = 'block';
      const w = Math.max(36, (cw - 8) * cw / sw);
      const x = (st.scrollLeft / (sw - cw)) * (cw - 8 - w);
      h.style.width = w + 'px'; h.style.transform = 'translateX(' + x + 'px)';
    }
    stripScroll() {
      this.updateBar();
      const h = this._hth; if (!h) return;
      h.setAttribute('data-active', '1');
      clearTimeout(h.__t); h.__t = setTimeout(() => h.removeAttribute('data-active'), 900);
    }

    // ---------- after each render ----------
    didRender() {
      const box = this._box; const sp = this._spacer;
      if (box && sp) {
        const sb = sp.getBoundingClientRect().bottom;
        const fixedH = box.offsetHeight - sp.offsetHeight;
        const belowSp = Math.round((box.getBoundingClientRect().bottom - sb) * 2) / 2;   // the part under the preview: stays the same while things move
        if (Math.abs(sb - this.lay.spacerBottom) > 0.5 || Math.abs(fixedH - this.lay.fixedH) > 0.5 || Math.abs(belowSp - (this.lay.belowSp || 0)) > 0.5) {
          this.lay = Object.assign(this.lay, { spacerBottom: sb, fixedH: fixedH, belowSp: belowSp });
          this.setState({ tick: this.S().tick + 1 });
        }
      }
      if (this._tb && this._tb.isConnected) { const r = Math.round(window.innerWidth - this._tb.getBoundingClientRect().right); if (r !== this.lay.tbRight) { this.lay.tbRight = r; this.setState({ tick: this.S().tick + 1 }); } }
      this.updateBar(); this.updateListBar();
      // Tell the window which area takes clicks; outside it, clicks go to the apps behind.
      const s = this.S();
      let rects;
      if (s.mode === 'edit') rects = [[0, 0, window.innerWidth, window.innerHeight]];
      else if (box) {
        const r = box.getBoundingClientRect();
        const top = s.mode === 'preview' ? Math.min(r.top, this.view(s).pv.y) : r.top;
        rects = [[r.left - 12, top - 48, r.width + 24, r.bottom - top + 60]];
        if (this.S().micMenu || this.S().micSettings) rects.push([r.right - 400, r.bottom - 540, 420, 540]);
      } else rects = [];
      if (box && s.mode !== 'edit' && this.S().toast) rects.push([window.innerWidth / 2 - 260, 0, 520, 70]);
      const key = JSON.stringify(rects.map((a) => a.map(Math.round)));
      if (key !== this._hit) { this._hit = key; Native.call('hit', { rects: rects }); }
    }

    // ---------- render values ----------
    renderVals() {
      const s = this.S();
      const listening = s.dict === 'on' || s.dict === 'system' || s.dict === 'rec'; const busy = s.dict === 'transcribing';
      const isEdit = s.mode === 'edit'; const isPv = s.mode === 'preview';
      if (this._wasEdit && !isEdit) { this._leaveUntil = Date.now() + 400; clearTimeout(this._leaveT); this._leaveT = setTimeout(() => this.setState({ tick: this.S().tick + 1 }), 420); }
      this._wasEdit = isEdit;
      const vw = this.view(s); const g = vw.g;
      const doc = s.docs[s.idx] || { shapes: [], w: M.DOC_W, h: M.DOC_H, crop: null };
      const tp = {};
      ['close', 'edit', 'prev', 'next', 'undo', 'redo', 'del', 'done', 'discard', 'cropok', 'cropno', 'add', 'wc', 'mic', 'wedge', 'send'].forEach((k) => {
        tp[k] = { show: s.tip === k, on: () => this.setState({ tip: k }), off: () => this.setState({ tip: null }) };
      });

      // Revise bar (board 3) + list (board 4)
      const rv = s.rv; const on = rv.on; const open = rv.open;
      const target = this.prompts.find((p) => p.n === rv.n) || this.prompts[0] || { n: 0, text: '' };
      const listCtx = rv.ctx === 'list';
      const T = 1240; const K = 430 / 740;
      const ez = open ? 'ease' : 'cubic-bezier(0.75, 0, 0.75, 0.9)';
      const at = (start, dur) => ms(open ? start : Math.round((T - (start + dur)) * K));
      const lwords = (str, start, step) => str.split(' ').filter(Boolean).map((t, i) => ({ text: t, op: open ? '1' : '0', ty: open ? '0px' : '8px', ease: ez, delay: at(start + i * step, 220) }));
      const rows = this.prompts.map((p, r) => {
        const sel = p.n === rv.n; const start = 360 + Math.min(r, 6) * 60;
        return {
          n: p.n, selStr: sel ? 'true' : 'false', bg: sel ? 'var(--bar-on)' : 'transparent', fg: sel ? 'var(--text)' : 'var(--text-2)',
          pillBg: sel ? 'var(--pill)' : 'var(--pill-muted)', pillFg: sel ? 'var(--pill-text)' : 'var(--pill-muted-text)',
          meta: (p.model || '?') + '/' + (p.effort || '?') + ' · v' + (p.v || 1),
          words: lwords(shortText(p.text, 16), start, 40), d: at(start, 260), pick: () => this.pickRow(p.n)
        };
      });
      const vis = Math.min(Math.max(rows.length, 1), 3);
      const listH = vis * 56 + (vis - 1) * 2;
      const rvText = '“' + shortText(target.text, 14) + '”';
      const rb = {
        n: target.n, onStr: on ? 'true' : 'false',
        label: on ? 'Revising prompt #' + target.n + ', click to turn revise off' : 'Revise is off, click to revise a previous prompt',
        slotLabel: on ? (open ? 'List of earlier prompts is open' : 'Choose which prompt to revise') : 'Turn revise on',
        bg: 'transparent', bstyle: on ? 'solid' : 'dashed', bcolor: on ? 'var(--bar-on-border)' : 'var(--bar-off-border)',
        slotBg: on ? 'var(--pill)' : 'var(--slot-off)', slotBorder: on ? 'var(--pill)' : 'var(--slot-off-border)',
        slotDelay: listCtx ? at(160, 260) : (on ? '0ms' : '250ms'),
        growDelay: listCtx ? at(160, 260) : (on ? '300ms' : '0ms'),
        slotW: !on ? '44px' : (open ? '44px' : '60px'),
        textRight: !on ? '72px' : (open ? '72px' : '88px'),
        chevY: !on ? '18px' : (open ? '-16px' : '0px'), chevOp: on && !open ? '1' : '0',
        chevEase: listCtx ? EASE : 'cubic-bezier(0.34, 1.3, 0.64, 1)', chevDelay: listCtx ? at(0, 220) : (on ? '300ms' : '0ms'),
        aX: on ? '44px' : '0px', nX: on ? '0px' : '-44px',
        pushDelay: on ? '250ms' : '0ms', bLeft: on ? '16px' : '-28px', textLeft: on ? '52px' : '16px',
        phWords: PH.split(' ').map((t, i) => ({ text: t, op: on ? '0' : '1', ty: on ? '-8px' : '0px', delay: (on ? 250 + i * 40 : 150 + i * 40) + 'ms' })),
        rvWords: rvText.split(' ').map((t, i) => ({ text: t, op: on && !rv.swap ? '1' : '0', ty: on && !rv.swap ? '0px' : '8px', delay: (rv.swap ? 0 : (on ? (listCtx ? i * 30 : 300 + i * 45) : i * 30)) + 'ms' }))
      };
      const rl = {
        expH: open ? (8 + 36 + 4 + listH + 6) + 'px' : '0px', expDelay: open ? ms(120) : ms(0),
        openStr: open ? 'true' : 'false', tab: open ? '0' : '-1', ez: ez,
        bounce: open ? 'cubic-bezier(0.34, 1.3, 0.64, 1)' : 'cubic-bezier(0.36, 0, 0.66, -0.3)',
        hChevOpD: at(240, 200), hChevTrD: at(240, 260), hChevOp: open ? '1' : '0', hChevY: open ? '0px' : '12px',
        hChevRot: open ? '180deg' : '0deg', hChevRotDelay: at(520, 300),
        headWords: lwords('Enhanced in this thread', 280, 60), rowOp: open ? '1' : '0', rowY: open ? '0px' : '10px', rows: rows
      };

      // Slides (board 6, real images)
      const slides = s.docs.map((d, i) => {
        let shapes = d.shapes;
        if (isEdit && i === s.idx && s.draft && s.draft.type !== 'crop') shapes = shapes.concat([Object.assign({ id: 'draft', c: s.color, sw: s.stroke }, M.fromDraft(s.draft))]);
        const c = d.crop;
        const moving = s.anim && (i === s.idx || i === s.prevIdx);
        const ci = c || { x: 0, y: 0, w: d.w, h: d.h };
        const bx = isEdit ? { w: vw.c.w, h: vw.c.h } : vw.box;
        const si = Math.min(bx.w / ci.w, bx.h / ci.h);
        const fit = 'translate(' + ((bx.w - ci.w * si) / 2 - ci.x * si) + 'px, ' + ((bx.h - ci.h * si) / 2 - ci.y * si) + 'px) scale(' + si + ')';
        const rot = (x) => { if (!x.rot) return ''; const ce = M.center(x); return 'rotate(' + x.rot + ' ' + ce.x + ' ' + ce.y + ')'; };
        return {
          op: i === s.idx ? '1' : '0', fit: fit, src: d.src, dw: d.w, dh: d.h, vb: '0 0 ' + d.w + ' ' + d.h,
          tr: moving ? 'opacity 160ms ease' : 'none',
          vis: i === s.idx || (s.anim && i === s.prevIdx) ? 'visible' : 'hidden',
          clip: c ? 'inset(' + c.y + 'px ' + (d.w - c.x - c.w) + 'px ' + (d.h - c.y - c.h) + 'px ' + c.x + 'px round 4px)' : 'inset(0px 0px 0px 0px)',
          rects: shapes.filter((x) => x.type === 'rect').map((x) => ({ x: x.x, y: x.y, w: x.w, h: x.h, c: x.c || s.color, sw: x.sw || M.STROKE, tf: rot(x) })),
          ellipses: shapes.filter((x) => x.type === 'ellipse').map((x) => ({ cx: x.x + x.w / 2, cy: x.y + x.h / 2, rx: x.w / 2, ry: x.h / 2, c: x.c || s.color, sw: x.sw || M.STROKE, tf: rot(x) })),
          arrows: shapes.filter((x) => x.type === 'arrow').map((x) => { const hd = M.head(x.x1, x.y1, x.x2, x.y2, x.sw); return { x1: x.x1, y1: x.y1, lx: hd.lx, ly: hd.ly, head: hd.head, c: x.c || s.color, sw: x.sw || M.STROKE, tf: rot(x) }; }),
          pens: shapes.filter((x) => x.type === 'pen').map((x) => ({ d: 'M' + x.pts.map((p) => p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' L'), c: x.c || s.color, sw: x.sw || M.STROKE, tf: rot(x) })),
          texts: shapes.filter((x) => x.type === 'text').map((x) => { const b = M.textBox(x); return { x: x.x, y: x.y, w: b.w, h: b.h, size: x.size || 24, rot: x.rot || 0, text: x.text, c: x.c || s.color, disp: isEdit && x.id === s.editId ? 'none' : 'block' }; })
        };
      });

      const palOpen = isEdit && ['rect', 'ellipse', 'arrow', 'pen', 'text'].indexOf(s.tool) !== -1;
      const wm = this.wedgeMode(s); const wv = this.wedgeValue(s);
      // Shows once an object or text has been added (it is selected then), not when a tool is picked.
      const wgShow = isEdit && s.sel != null;
      const wg = { right: this.lay.tbRight != null ? this.lay.tbRight : 24, hidden: wgShow ? 'false' : 'true', op: wgShow ? '1' : '0', pe: wgShow ? 'auto' : 'none', ty: wgShow ? '0px' : '-8px',
        min: wm.min, max: wm.max, val: wv, x: Math.round(7 + (wv - wm.min) / (wm.max - wm.min) * 186),
        aria: wm.text ? 'Text size' : 'Line thickness', label: wm.text ? 'Text size · ' + wv : 'Thickness · ' + wv + 'px' };
      const isCustom = !PRESETS.some((p) => p.hex === s.color);
      const toolBtn = (t) => ({
        aria: t[1] + ' (' + t[2] + ')', name: t[1], key: t[2], icon: ICONS[t[0]],
        bg: s.tool === t[0] ? 'var(--tool-on-bg)' : 'transparent', fg: s.tool === t[0] ? 'var(--tool-on-fg)' : 'var(--tool-fg)',
        pick: () => this.setTool(t[0]), showTip: s.tip === 't-' + t[0],
        tipOn: () => this.setState({ tip: 't-' + t[0] }), tipOff: () => this.setState({ tip: null })
      });
      const selSh = s.sel == null ? null : doc.shapes.find((x) => x.id === s.sel) || null;
      const sb0 = selSh ? M.bbox(selSh) : { x: 0, y: 0, w: 0, h: 0 };
      const es = vw.ed.s; const pad = 6 / es;
      const edSh = s.editId == null ? null : doc.shapes.find((x) => x.id === s.editId) || null;
      const cdr = isEdit && s.draft && s.draft.type === 'crop' ? M.fromDraft(s.draft) : null;
      const empty = !s.docs.length && !(this._ta && !RichEdit.isEmpty(this._ta));
      const idle = s.idle && empty && !open && s.mode === 'closed' && s.dict === 'off';

      return {
        W: g.W, H: g.H, BW: g.BW, CX: g.CX, BB: g.BB,
        boxTr: 'border-color 200ms ease, bottom 380ms cubic-bezier(0.42, 0, 0.58, 1)',
        boxPad: idle ? '0px' : '14px 16px',
        handleOn: (s.mode || 'closed') !== 'edit', handleW: Math.round(g.BW * 0.1),
        handleDown: (e) => this.handleDown(e),
        boxBorder: 'var(--box-border)',
        idle: idle, awake: !idle,
        wake: () => { this.setState({ idle: false }); this.focusText(); },
        hasRevise: this.prompts.length > 0, rb: rb, rl: rl,
        toggleRevise: () => this.toggleRevise(), slotClick: (e) => this.slotClick(e), closeList: (e) => this.closeList(e), barKey: (e) => this.barKey(e),
        hasImgs: s.docs.length > 0,
        thumbs: s.docs.map((d, i) => ({
          src: d.src, label: 'Open image ' + (i + 1), removeLabel: 'Remove image ' + (i + 1), edited: M.hasEdits(d),
          border: s.mode !== 'closed' && i === s.idx ? '2px solid var(--accent)' : '1px solid var(--thumb-border)',
          pick: () => this.pick(i), remove: (e) => { e.stopPropagation(); this.removeImage(i); },
          xOp: s.hover === i && !isEdit ? '1' : '0', xPe: s.hover === i && !isEdit ? 'auto' : 'none',
          hoverOn: () => this.setState({ hover: i }), hoverOff: () => this.setState({ hover: -1 })
        })),
        placeholder: listening ? '' : 'Enhance your prompt',
        wcStr: s.wc ? 'true' : 'false', wcBorder: s.wc ? 'var(--accent)' : 'var(--thumb-border)', wcColor: s.wc ? 'var(--accent)' : 'var(--icon)',
        wcTip: s.wc ? 'Using this conversation as context' : 'Not using this conversation',
        toggleWc: () => this.setState({ wc: !s.wc }),
        dictate: () => this.toggleDictation(),
        // While the mic listens, the send button is a stop square: it stops the recording (the mic does too).
        // While the words are being written (Whisper), the button spins and the box is grayed and locked,
        // until the text is in the box.
        sendBtn: () => { if (busy) return; if (listening) this.stopDictation(); else this.send(); },
        listening: listening, busy: busy, showSend: !listening && !busy, listenStr: listening ? 'true' : 'false', busyStr: busy ? 'true' : 'false',
        taEditable: busy ? 'false' : 'true', taOp: busy ? '0.45' : '1', taPe: busy ? 'none' : 'auto',
        sendLabel: busy ? 'Writing what you said…' : (listening ? 'Stop recording' : 'Send (⌘↵)'), sendTip: busy ? 'Writing what you said…' : (listening ? 'Stop recording' : 'Send'), sendKey: busy ? '' : (listening ? 'Click' : '⌘↵'),
        micDown: (e) => this.micDown(e), micUp: (e) => this.micUp(e), micLeave: () => this.micLeave(), micKey: (e) => this.micKey(e),
        micStr: s.dict !== 'off' ? 'true' : 'false',
        micColor: s.dict === 'on' || s.dict === 'system' || s.dict === 'rec' ? (this._dictEngine === 'mac' ? 'var(--mac-green)' : 'var(--accent)') : (s.dict === 'transcribing' ? 'var(--faint)' : 'var(--icon)'),
        micLabel: s.dict !== 'off' ? 'Stop dictation' : 'Dictate',
        micTip: s.dict === 'starting' ? 'Starting…' : s.dict === 'rec' ? 'Recording… click to write it' : s.dict === 'transcribing' ? 'Writing what you said…' : (s.dict !== 'off' ? 'Listening… click to stop' : 'Dictate · ' + this.langName((this.settings || {}).lang || 'en') + ' · hold for languages'),
        mm: (() => {
          const st = this.settings || {}; const eng = st.engine || 'mac';
          return {
            open: s.micMenu && s.dict === 'off',
            engineName: { whisper: 'Whisper Turbo', mac: 'Mac dictation' }[eng] || 'Dictation',
            langs: (st.languages || []).map((c) => ({ name: this.langName(c), onStr: c === st.lang ? 'true' : 'false', check: c === st.lang ? '✓' : '', note: this.langOk(c, eng) ? '' : 'not in this engine', pick: () => { this.settings.lang = c; this.saveSettings(); this.setState({ micMenu: false }); this.focusText(); } })),
            openSettings: () => this.setState({ micMenu: false, micSettings: true, msDrop: null })
          };
        })(),
        mp: { open: (s.micMenu || s.micSettings) && s.dict === 'off', menu: s.micMenu && !s.micSettings, settings: s.micSettings, w: s.micSettings ? 288 : 230 },
        ms: (() => {
          const st = this.settings || {}; const info = this.dictInfo || {}; const eng = st.engine || 'mac';
          const SHORT = { whisper: 'Whisper Turbo', mac: 'Mac dictation' };
          const q = s.msQ || {}; const so = s.msSearch || {};
          if (s.micSettings) this.msBarsSoon();
          const field = (key, rows, value, rowH, hasSearch) => {
            const open = s.msDrop === key; const sOpen = !!so[key];
            rows.forEach((r) => { r.tab = open && !r.disabled ? '0' : '-1'; });
            return {
              open: open, openStr: open ? 'true' : 'false', closedStr: open ? 'false' : 'true',
              expH: open ? (rows.length ? Math.min(rows.length, 3) * rowH : 34) + 6 : 0,
              value: value, rows: rows, empty: rows.length === 0, rowH: rowH, maxH: rowH * 3 + 6, hasSearch: hasSearch,
              // Opening one list closes the other one (and its search).
              toggle: () => {
                if (open) { this.setState({ msDrop: null }); return; }
                const cur = this.S(); const ns = {}; const nq = {};
                if ((cur.msSearch || {})[key]) { ns[key] = true; nq[key] = (cur.msQ || {})[key] || ''; }
                this.setState({ msDrop: key, msSearch: ns, msQ: nq });
              },
              q: q[key] || '', inputW: sOpen ? '266px' : '30px', inputOp: sOpen ? '1' : '0', inputTab: sOpen ? '0' : '-1',
              inputBorder: sOpen ? 'var(--box-border-strong)' : 'var(--tip-border)', sOpenStr: sOpen ? 'true' : 'false',
              // While searching, the "Title: value" line slides up one row and the field opens in its place.
              capH: sOpen ? 36 : 0, labelY: sOpen ? -36 : 0, rowPE: sOpen ? 'none' : 'auto',
              onQ: (e) => this.setState({ msQ: { [key]: e.target.value }, msDrop: key }),
              toggleSearch: () => {
                const cur = this.S(); const ns = {}; const nq = {};
                if (!(cur.msSearch || {})[key]) { ns[key] = true; nq[key] = ''; }
                this.setState({ msSearch: ns, msQ: nq, msDrop: ns[key] ? key : cur.msDrop });
                if (ns[key]) setTimeout(() => { const el = this['_q_' + key]; if (el) el.focus(); }, 250);
              },
              inputRef: this['_qr_' + key] || (this['_qr_' + key] = (el) => { this['_q_' + key] = el; }),
              listRef: this['_mslr_' + key] || (this['_mslr_' + key] = (el) => { this['_msl_' + key] = el; this.msBarsSoon(); }),
              thumbRef: this['_mstr_' + key] || (this['_mstr_' + key] = (el) => { this['_msth_' + key] = el; this.msBarsSoon(); }),
              onScroll: () => this.msShowBar(key)
            };
          };
          const mq = (q.model || '').toLowerCase(); const lq = (q.lang || '').toLowerCase();
          const models = ENGINES.filter((g) => !mq || (SHORT[g[0]] + ' ' + g[2]).toLowerCase().indexOf(mq) !== -1).map((g) => ({
            name: SHORT[g[0]], desc: info[g[0]] ? g[2] : 'Not installed on this Mac', hasDesc: true, disabled: !info[g[0]],
            onStr: g[0] === eng ? 'true' : 'false', mark: g[0] === eng ? '●' : '', note: '',
            isMac: g[0] === 'mac', notMac: g[0] !== 'mac', markColor: g[0] === 'mac' ? (eng === 'mac' ? 'var(--mac-green)' : 'var(--faint)') : 'var(--accent)',
            // Picking a model keeps the list open.
            pick: () => { this.settings.engine = g[0]; this.saveSettings(); } }));
          const langs = LANGS.filter((l) => !lq || l[1].toLowerCase().indexOf(lq) !== -1 || l[0] === lq).map((l) => { const on = (st.languages || []).indexOf(l[0]) !== -1; return {
            name: l[1], desc: '', hasDesc: false, disabled: false, onStr: on ? 'true' : 'false', mark: on ? '✓' : '',
            isMac: false, notMac: true, markColor: 'var(--accent)',
            note: this.langOk(l[0], eng) ? '' : 'not in this engine',
            pick: () => { const arr = (this.settings.languages || []).slice(); const i = arr.indexOf(l[0]);
              if (i === -1) arr.push(l[0]); else if (arr.length > 1) arr.splice(i, 1);
              this.settings.languages = arr; if (arr.indexOf(this.settings.lang) === -1) this.settings.lang = arr[0]; this.saveSettings(); } }; });
          return {
            close: () => this.setState({ micSettings: false, micMenu: true, msDrop: null, msSearch: {}, msQ: {} }),
            model: field('model', models, SHORT[eng] || 'Dictation', 48, ENGINES.length > 3),
            lang: field('lang', langs, (st.languages || []).map((c) => this.langName(c)).join(', ') || 'None', 34, true)
          };
        })(),
        addImages: () => this.pickImages(),
        onText: () => { this.autoGrow(); if (s.idle) this.setState({ idle: false }); }, onTextScroll: () => this.textScroll(),
        taKey: (e) => this.taKey(e), onPaste: (e) => this.onPaste(e),
        onTaFocus: () => { if (this.S().idle) this.setState({ idle: false }); },
        dragOver: (e) => { e.preventDefault(); }, drop: (e) => { e.preventDefault(); if (this.S().dict === 'transcribing') return; const f = Array.from((e.dataTransfer && e.dataTransfer.files) || []).filter((x) => x.type.indexOf('image/') === 0); if (f.length) this.readFiles(f); },
        onStripWheel: (e) => { const el = e.currentTarget; if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { el.scrollLeft += e.deltaY; e.preventDefault(); } },
        onStripScroll: () => this.stripScroll(),
        tp: tp,
        isEdit: isEdit,
        // Keep the editor toolbars a moment after leaving, so they fade out with the image.
        edChromeOn: isEdit || Date.now() < (this._leaveUntil || 0), edOnStr: isEdit ? 'true' : 'false',
        pvH: s.mode === 'closed' || !s.docs.length ? '0px' : (vw.pv.h + 14) + 'px',
        backOp: isEdit ? '1' : '0', backPe: isEdit ? 'auto' : 'none', backDelay: isEdit ? '0ms' : '120ms',
        st: {
          tf: isEdit ? 'translate(' + vw.ed.x + 'px, ' + vw.ed.y + 'px) scale(' + vw.ed.s + ')' : 'translate(' + vw.pv.x + 'px, ' + vw.pv.y + 'px) scale(' + vw.pv.s + ')',
          w: isEdit ? vw.c.w : vw.box.w, h: isEdit ? vw.c.h : vw.box.h, ox: -vw.c.x, oy: -vw.c.y,
          clipTop: s.mode === 'closed' ? '100%' : '0%', pe: s.mode === 'closed' ? 'none' : 'auto',
          op: s.fadeIn ? '0.35' : '1',
          // One timing for every part (macOS's standard ease-in-out), so nothing runs ahead of its container.
          tr: this._snap ? 'clip-path 380ms cubic-bezier(0.42, 0, 0.58, 1)' : 'transform 380ms cubic-bezier(0.42, 0, 0.58, 1), width 380ms cubic-bezier(0.42, 0, 0.58, 1), height 380ms cubic-bezier(0.42, 0, 0.58, 1), clip-path 380ms cubic-bezier(0.42, 0, 0.58, 1), opacity 160ms ease',
          tri: this._snap ? 'none' : 'transform 380ms cubic-bezier(0.42, 0, 0.58, 1)',
          radius: Math.round((isEdit ? 12 / vw.ed.s : 6 / vw.pv.s) * 10) / 10
        },
        cursor: !isEdit ? 'default' : s.tool === 'select' ? 'default' : s.tool === 'text' ? 'text' : 'crosshair',
        slides: slides,
        imgLabel: s.docs.length ? 'Image ' + (s.idx + 1) + ' of ' + s.docs.length : 'No image',
        chromeOp: isPv ? '1' : '0', chromePe: isPv ? 'auto' : 'none',
        chromeDelay: isPv ? '380ms' : '0ms',   // the controls appear once the image has landed
        arrLOp: s.near === 'l' && s.idx > 0 ? '1' : '0', arrLPe: s.near === 'l' && s.idx > 0 ? 'auto' : 'none',
        arrROp: s.near === 'r' && s.idx < s.docs.length - 1 ? '1' : '0', arrRPe: s.near === 'r' && s.idx < s.docs.length - 1 ? 'auto' : 'none',
        nearL: () => this.setState({ near: 'l' }), nearR: () => this.setState({ near: 'r' }), nearOff: () => this.setState({ near: null, tip: null }),
        pc: { x0: vw.pv.x, y0: vw.pv.y, h: vw.pv.h, xr: vw.pv.x + vw.pv.w - 170, xl: vw.pv.x + 12, top: vw.pv.y + 12, ex: vw.pv.x + vw.pv.w - 12 },
        hasCropDraft: !!cdr || (isEdit && !!s.pendingCrop),
        cd: cdr || s.pendingCrop || { x: 0, y: 0, w: 0, h: 0 },
        hasCropBtns: isEdit && !cdr && !!s.pendingCrop,
        cb: s.pendingCrop ? { x: vw.ed.x + (s.pendingCrop.x - vw.c.x + s.pendingCrop.w) * es + 10, y: vw.ed.y + (s.pendingCrop.y - vw.c.y + s.pendingCrop.h) * es - 78 } : { x: 0, y: 0 },
        applyCrop: () => this.applyCrop(), cancelCrop: () => this.cancelCrop(), discard: () => this.discard(),
        hasSel: isEdit && !!selSh && s.editId == null,
        sb: { x: sb0.x - pad, y: sb0.y - pad, w: sb0.w + pad * 2, h: sb0.h + pad * 2, rot: selSh ? (selSh.rot || 0) : 0,
          bw: 1.5 / es, hs: 14 / es, ho: -8 / es, hb: 2 / es, hr: 4 / es, rs: 26 / es, ro: -30 / es },
        isEditingText: isEdit && !!edSh,
        editText: edSh ? edSh.text : '',
        ed: edSh ? (() => { const b = M.textBox(edSh); const w = Math.max(160, b.w + 28); return { x: b.x + b.w / 2 - w / 2, y: b.y, w: w, h: b.h, size: edSh.size || 24, rot: edSh.rot || 0, c: edSh.c || s.color, bw: 1.5 / es }; })() : { x: 0, y: 0, w: 0, h: 34, size: 24, rot: 0, c: s.color, bw: 1.5 },
        toolsA: TOOLS_A.map(toolBtn), toolsB: TOOLS_B.map(toolBtn),
        palHidden: palOpen ? 'false' : 'true', palW: palOpen ? '330px' : '0px',
        wg: wg, wgDown: (e) => this.wgDown(e), wgMove: (e) => this.wgMove(e), wgUp: () => { this._wgDrag = false; }, wgKey: (e) => this.wgKey(e), palDelay: palOpen ? '0ms' : '160ms',
        palOp: palOpen ? '1' : '0', palSepDelay: palOpen ? '60ms' : '0ms',
        swatches: PRESETS.map((p, i) => ({
          name: p.name + ' color', hex: p.hex, pressed: s.color === p.hex ? 'true' : 'false', tab: palOpen ? '0' : '-1',
          op: palOpen ? '1' : '0', tx: palOpen ? '0px' : '-10px', d: (palOpen ? 90 + i * 35 : (PRESETS.length - i) * 15) + 'ms',
          ring: s.color === p.hex ? '0 0 0 2px var(--toolbar), 0 0 0 4px var(--text)' : 'inset 0 0 0 1px rgba(128,128,128,0.45)',
          pick: () => this.setColor(p.hex)
        })),
        pk: { op: palOpen ? '1' : '0', tx: palOpen ? '0px' : '-10px', d: palOpen ? (90 + PRESETS.length * 35) + 'ms' : '0ms', tab: palOpen ? '0' : '-1', ring: isCustom ? '0 0 0 2px var(--toolbar), 0 0 0 4px var(--text)' : 'none' },
        colorHex: s.color, pickCustom: (e) => this.setColor(e.target.value),
        undoColor: s.past.length ? 'var(--icon)' : 'var(--disabled)', redoColor: s.future.length ? 'var(--icon)' : 'var(--disabled)',
        hint: HINTS[s.tool], hintTop: g.H - 78,
        onKey: (e) => this.onKey(e),
        rootRef: this._r1 || (this._r1 = (el) => { this._root = el; }),
        boxRef: this._r2 || (this._r2 = (el) => { this._box = el; if (el && !this._ro && window.ResizeObserver) { this._ro = new ResizeObserver(() => this.setState({ tick: this.S().tick + 1 })); this._ro.observe(el); } }),
        spacerRef: this._r3 || (this._r3 = (el) => { this._spacer = el; }),
        stripRef: this._r4 || (this._r4 = (el) => { this._strip = el; setTimeout(() => this.updateBar(), 30); }),
        hThumbRef: this._r5 || (this._r5 = (el) => { this._hth = el; setTimeout(() => this.updateBar(), 30); }),
        taRef: this._r6 || (this._r6 = (el) => { if (el && el !== this._ta) { this._ta = el; RichEdit.attach(el, { onChange: () => this.autoGrow(), openLink: (u) => Native.call('openLink', { url: u }) }); this.syncEmpty(); } }),
        textThumbRef: this._r9 || (this._r9 = (el) => { this._tth = el; }),
        listRef: this._r10 || (this._r10 = (el) => { this._list = el; setTimeout(() => this.updateListBar(), 700); }),
        listThumbRef: this._r11 || (this._r11 = (el) => { this._lth = el; }), onListScroll: () => this.listScroll(),
        editRef: this._r7 || (this._r7 = (el) => this.focusEdit(el)),
        toolbarRef: this._r8 || (this._r8 = (el) => { this._tb = el; }),
        mdown: (e) => this.mdown(e), down: (e) => this.down(e), move: (e) => this.move(e), up: (e) => this.up(e), dbl: (e) => this.dbl(e),
        onEditInput: (e) => this.onEditInput(e), endEdit: () => this.endEdit(),
        undo: () => this.undo(), redo: () => this.redo(), delSel: () => this.delSel(), done: () => this.done(),
        enterEdit: () => this.enterEdit(), closePv: () => this.closePv(), prev: () => this.go(-1), next: () => this.go(1),
        toastText: s.toast ? s.toast.text : '', toastOp: s.toast ? '1' : '0', toastY: s.toast ? '0px' : '-8px'
      };
    }
  }

  const app = new Popup();
  window.__popup = app;
  DC.mount(document.getElementById('app'), document.getElementById('tpl').innerHTML, app);
  window.addEventListener('resize', () => app.setState({ tick: app.S().tick + 1 }));
  window.__dictation = (m) => app.onDictation(m);
  document.addEventListener('mousedown', (e) => { if (!(e.target.closest && e.target.closest('[role=menu],[role=dialog],[aria-haspopup]'))) app.closeMenus(); });
  window.addEventListener('blur', () => app.setState({ idle: true }));
  window.addEventListener('focus', () => { if (app.S().idle) { app.setState({ idle: false }); app.focusText(); } });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());
  app.init();
})();
