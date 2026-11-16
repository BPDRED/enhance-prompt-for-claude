// result.js: the result window (board 7). Shows the enhanced prompt, lets you edit it (auto-saved,
// ⌘Z / ⇧⌘Z), switch to the original, copy text or images, and paste everything into the chat.
(function () {
  'use strict';

  class Result extends DCLogic {
    constructor() { super(); this.data = null; this._hist = null; }
    S() {
      const s = this.state || {};
      return {
        sel: s.sel || [], view: !!s.view, idx: s.idx == null ? 0 : s.idx, prevIdx: s.prevIdx == null ? -1 : s.prevIdx,
        orig: s.orig || {}, showOrig: !!s.showOrig, tip: s.tip || null, near: s.near || null, toast: s.toast || null,
        saving: !!s.saving, anim: s.anim || null, notes: !!s.notes, tick: s.tick || 0, loaded: !!s.loaded
      };
    }
    async init() {
      let d = null;
      try { d = await Native.call('initResult'); } catch (e) { d = null; }
      this.data = d || { n: 0, text: '', original: '', images: [], error: 'Could not load the result.' };
      this.data.images = this.data.images || [];
      const orig = {};
      // Images whose edits were turned off last time stay off.
      this.data.images.forEach((im, i) => { if (im.edited && im.useEdited === false) orig[i] = true; });
      this.setState({ loaded: true, orig: orig });
      if (this._ta) this.fill(this._ta);
      if (this.data.notice) setTimeout(() => this.say(this.data.notice), 400);
    }
    imgs() { return this.data ? this.data.images : []; }
    enhanced() { return this.data ? (this.data.error ? this.data.error : (this.data.text || '')) : ''; }
    original() { return this.data ? (this.data.original || '') : ''; }
    say(text) {
      this._tid = (this._tid || 0) + 1; const id = this._tid;
      this.setState({ toast: { text: text, id: id } });
      clearTimeout(this._tt); this._tt = setTimeout(() => { if (this._tid === id) this.setState({ toast: null }); }, 2200);
    }
    // ----- images -----
    useEdited(i) { const im = this.imgs()[i]; return !!(im && im.edited && !this.S().orig[i]); }
    pathFor(i, forceOrig) { const im = this.imgs()[i]; return forceOrig || !this.useEdited(i) ? im.origPath : im.editedPath; }
    chosen() { const s = this.S(); const n = this.imgs().length; return s.sel.length ? s.sel.slice() : Array.from({ length: n }, (_, i) => i); }
    toggleSel(i) {
      const s = this.S(); const has = s.sel.indexOf(i) >= 0;
      this.setState({ sel: has ? s.sel.filter((x) => x !== i) : s.sel.concat([i]).sort((a, b) => a - b) });
    }
    copyOriginal(i) {
      // A double-click is also two clicks; those two toggles cancel out, so the selection stays as it was.
      const im = this.imgs()[i];
      Native.call('copyImages', { paths: [im.origPath] }).then(() => this.say(im.edited ? 'Original of image ' + (i + 1) + ' copied (without your edits)' : 'Image ' + (i + 1) + ' copied (it has no edits)'));
    }
    copyImgs() {
      const s = this.S(); const ids = this.chosen();
      Native.call('copyImages', { paths: ids.map((i) => this.pathFor(i)) }).then(() => {
        if (s.sel.length) this.say(s.sel.length === 1 ? 'Image ' + (s.sel[0] + 1) + ' copied' : s.sel.length + ' selected images copied');
        else this.say('All ' + ids.length + ' images copied');
      });
    }
    toggleEdits(i) {
      const s = this.S(); const orig = Object.assign({}, s.orig); orig[i] = !orig[i];
      this.setState({ orig: orig });
      Native.call('setUseEdited', { index: i, value: !orig[i] });
      this.say(orig[i] ? 'Image ' + (i + 1) + ': edits off, the original will be used' : 'Image ' + (i + 1) + ': edits on');
    }
    openView(i) { this.setState({ view: true, idx: i, prevIdx: -1, near: null, tip: null }); setTimeout(() => { if (this._root) this._root.focus(); }, 0); }
    closeView() { this.setState({ view: false, near: null, tip: null }); }
    go(d) {
      const s = this.S(); const n = Math.max(0, Math.min(this.imgs().length - 1, s.idx + d));
      if (n !== s.idx) this.setState({ prevIdx: s.idx, idx: n });
    }
    switchOrig() {
      const s = this.S();
      if (!this.imgs()[s.idx] || !this.imgs()[s.idx].edited) { this.say('Image ' + (s.idx + 1) + ' has no edits'); return; }
      this.toggleEdits(s.idx);
    }
    // ----- prompt text -----
    // The prompt is Markdown, shown formatted in an editable box. The browser keeps its own ⌘Z history
    // because we never rewrite the box while you edit it.
    fill(el) {
      if (!el || el.__filled || !this.data) return;
      el.__filled = true;
      if (this.data.error) { el.textContent = this.data.error; }
      else el.innerHTML = MD.mdToHtml(this.enhanced());
      this._savedText = this.richText();
      this._hist = [{ html: el.innerHTML, caret: 0 }]; this._hi = 0; this._last = 0;
      setTimeout(() => this.updateBars(), 30);
    }
    // Own ⌘Z history (snapshots of the formatted text + caret), so undo works the same everywhere.
    caretGet() {
      const el = this._ta; const sel = window.getSelection();
      if (!el || !sel || !sel.rangeCount || !el.contains(sel.focusNode)) return 0;
      const r = document.createRange(); r.setStart(el, 0); r.setEnd(sel.focusNode, sel.focusOffset);
      return r.toString().length;
    }
    caretSet(n) {
      const el = this._ta; if (!el) return;
      const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let node; let left = n;
      while ((node = w.nextNode())) {
        if (left <= node.nodeValue.length) { const r = document.createRange(); r.setStart(node, left); r.collapse(true); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); return; }
        left -= node.nodeValue.length;
      }
      const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
    }
    snapshot() {
      const el = this._ta; if (!el || !this._hist) return;
      const now = Date.now(); const snap = { html: el.innerHTML, caret: this.caretGet() };
      if (now - this._last > 700 || this._hi === 0) { this._hist = this._hist.slice(0, this._hi + 1).concat([snap]); this._hi += 1; }
      else { this._hist[this._hi] = snap; this._hist = this._hist.slice(0, this._hi + 1); }
      this._last = now;
    }
    stepHistory(d) {
      const el = this._ta; if (!el || !this._hist) return;
      const n = this._hi + d; if (n < 0 || n >= this._hist.length) return;
      const target = this._hist[n]; const caret = d < 0 ? this._hist[this._hi].caret : target.caret;
      this._hi = n; this._last = 0; el.innerHTML = target.html;
      this.caretSet(d < 0 ? Math.min(caret, el.textContent.length) : target.caret);
      this.markSaving(); this.updateBars();
    }
    handleDown(e) {
      if (e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();
      const el = e.currentTarget; el.setAttribute('data-active', '1');
      const up = () => { el.removeAttribute('data-active'); window.removeEventListener('pointerup', up); window.removeEventListener('blur', up); };
      window.addEventListener('pointerup', up); window.addEventListener('blur', up);
      if (e.detail < 2) Native.call('dragWindow');
    }
    richText() { return this._ta ? MD.htmlToMd(this._ta) : this.enhanced(); }
    onPromptInput() { this.snapshot(); this.markSaving(); this.updateBars(); }
    onTaKey(e) {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); e.stopPropagation(); this.stepHistory(e.shiftKey ? 1 : -1); }
      else if (mod && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); e.stopPropagation(); this.stepHistory(1); }
    }
    onRichPaste(e) {
      // Paste as plain text so outside styling does not leak in.
      const t = e.clipboardData && e.clipboardData.getData('text/plain');
      if (t == null) return;
      e.preventDefault(); document.execCommand('insertText', false, t);
    }
    markSaving() {
      this.setState({ saving: true });
      clearTimeout(this._st);
      this._st = setTimeout(() => this.flush(), 700);
    }
    flush() {
      clearTimeout(this._st);
      if (!this._ta || !this.data || this.data.error) { this.setState({ saving: false }); return Promise.resolve(true); }
      const text = this.richText();
      if (text === this._savedText) { this.setState({ saving: false }); return Promise.resolve(true); }
      return Native.call('saveText', { text: text }).then(() => { this._savedText = text; this.setState({ saving: false }); return true; })
        .catch(() => { this.say('Could not save your edit'); return false; });
    }
    currentText() { return this.S().showOrig ? this.original() : this.richText(); }
    currentHtml() { return this.S().showOrig ? null : MD.mdToPasteHtml(this.richText()); }
    copyPrompt() { const o = this.S().showOrig; Native.call('copyText', { text: this.currentText(), html: this.currentHtml() }).then(() => this.say(o ? 'Original prompt copied' : 'Prompt copied')); }
    async paste() {
      await this.flush();
      const ids = this.imgs().length ? this.chosen() : [];
      const r = await Native.call('paste', { text: this.currentText(), html: this.currentHtml(), paths: ids.map((i) => this.pathFor(i)) });
      if (r && r.needsPermission) this.say('Allow "Enhance Prompt" under Privacy › Accessibility, then try again');
      else if (r && r.noClaude) this.say('Claude is not running');
      else if (r && r.ok) this.say(ids.length ? 'Pasted ' + ids.length + ' image' + (ids.length > 1 ? 's' : '') + ' and the prompt' : 'Pasted the prompt');
    }
    // ----- word-by-word switch -----
    switchPrompt() {
      const s = this.S(); const toOrig = !s.showOrig;
      const src = s.showOrig ? this._orig : this._ta;
      const shown = () => (this._ta ? this._ta.innerText : this.enhanced());
      const fromText = s.showOrig ? this.original() : shown();
      const toText = toOrig ? this.original() : shown();
      const count = (t) => t.split(/\s+/).filter(Boolean).length;
      const nOut = Math.max(count(fromText), 1); const nIn = Math.max(count(toText), 1);
      const kOut = Math.min(40, 450 / nOut); const kIn = Math.min(40, 450 / nIn);
      const inStart = 140;
      const total = Math.max(Math.round(nOut * kOut), inStart + Math.round(nIn * kIn)) + 240;
      const anim = { fromText: fromText, toText: toText, fromOrig: !toOrig, kOut: kOut, kIn: kIn, inStart: inStart, fromY: src ? -src.scrollTop : 0, run: false };
      (this._animT || []).forEach((t) => clearTimeout(t));
      this.setState({ showOrig: toOrig, anim: anim });
      this._animT = [
        setTimeout(() => this.setState({ anim: Object.assign({}, anim, { run: true }) }), 30),
        setTimeout(() => { this.setState({ anim: null }); setTimeout(() => { const el = toOrig ? this._orig : this._ta; if (el) el.scrollTop = 0; this.updateBars(); }, 20); }, 30 + total)
      ];
    }
    animVals(a) {
      if (!a) return { from: [], to: [], fromColor: 'var(--text)', toColor: 'var(--text)', fromY: '0px' };
      let fi = 0; let ti = 0;
      const lines = (text, out) => text.split('\n').map((line) => ({ words: line.split(' ').filter(Boolean).map((w) => {
        const i = out ? fi++ : ti++;
        const d = Math.round(out ? i * a.kOut : a.inStart + i * a.kIn);
        return out ? { text: w, op: a.run ? '0' : '1', ty: a.run ? '-8px' : '0px', delay: d + 'ms' } : { text: w, op: a.run ? '1' : '0', ty: a.run ? '0px' : '8px', delay: d + 'ms' };
      }) }));
      return { from: lines(a.fromText, true), to: lines(a.toText, false), fromColor: a.fromOrig ? 'var(--muted)' : 'var(--text)', toColor: a.fromOrig ? 'var(--text)' : 'var(--muted)', fromY: a.fromY + 'px' };
    }
    // ----- scroll bars -----
    showScrollbar(el) {
      if (!el) return;
      const th = el === this._strip ? this._hth : this._vth;
      this.updateBars(); if (!th) return;
      th.setAttribute('data-active', '1');
      clearTimeout(th.__hideT); th.__hideT = setTimeout(() => th.removeAttribute('data-active'), 900);
    }
    updateBars() {
      const st = this._strip; const h = this._hth;
      if (st && h) {
        const cw = st.clientWidth; const sw = st.scrollWidth;
        if (sw <= cw + 1) h.style.display = 'none';
        else { h.style.display = 'block'; const w = Math.max(36, cw * cw / sw); const x = (st.scrollLeft / (sw - cw)) * (cw - w); h.style.width = w + 'px'; h.style.transform = 'translateX(' + x + 'px)'; }
      }
      const v = this._vth; const el = this.S().showOrig ? this._orig : this._ta;
      if (el && v) {
        const ch = el.clientHeight; const sh = el.scrollHeight;
        if (!ch || sh <= ch + 1) v.style.display = 'none';
        else { v.style.display = 'block'; const hh = Math.max(36, ch * ch / sh); const y = (el.scrollTop / (sh - ch)) * (ch - hh); v.style.height = hh + 'px'; v.style.transform = 'translateY(' + y + 'px)'; }
      }
    }
    onKey(e) {
      const s = this.S();
      if ((e.metaKey || e.ctrlKey) && (e.key === 'w' || e.key === 'W')) { e.preventDefault(); this.flush().then(() => Native.call('close')); return; }
      if (!s.view) { if (e.key === 'Escape' && s.notes) { e.preventDefault(); this.setState({ notes: false }); } return; }
      if (e.key === 'ArrowLeft') { e.preventDefault(); this.go(-1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); this.go(1); }
      else if (e.key === 'Escape') { e.preventDefault(); this.closeView(); }
    }
    renderVals() {
      const s = this.S(); const d = this.data || { images: [] };
      const imgs = this.imgs(); const n = imgs.length;
      const W = window.innerWidth; const H = window.innerHeight;
      const tp = {};
      ['view', 'copyImgs', 'copyPrompt', 'close', 'prev', 'next', 'paste'].forEach((k) => { tp[k] = { show: s.tip === k, on: () => this.setState({ tip: k }), off: () => this.setState({ tip: null }) }; });
      const cur = imgs[s.idx] || { edited: false };
      const curOrig = !!s.orig[s.idx];
      const ease = 'transform 480ms cubic-bezier(0.65, 0, 0.35, 1)';
      const SW = Math.max(200, W - 160); const VH = Math.max(200, H - 147);
      const copyImgsLabel = s.sel.length ? (s.sel.length === 1 ? 'Copy image ' + (s.sel[0] + 1) : 'Copy ' + s.sel.length + ' selected images') : 'Copy all ' + n + ' images';
      const notes = [];
      if (d.notes && d.notes.length) notes.push({ title: 'Note', items: d.notes });
      if (d.gaps && d.gaps.length) notes.push({ title: 'Gaps you could fill', items: d.gaps });
      if (d.changes && d.changes.length) notes.push({ title: 'What changed', items: d.changes });
      const gapN = (d.gaps || []).length;
      const model = d.model ? d.model.charAt(0).toUpperCase() + d.model.slice(1) : '';
      return {
        rootRef: this._rf1 || (this._rf1 = (el) => { this._root = el; }),
        onKey: (e) => this.onKey(e), tp: tp,
        handleW: Math.round(W * 0.1), handleDown: (e) => this.handleDown(e), handleDbl: () => Native.call('zoomWindow'),
        headTop: 16, imgTop: 60, promptTop: n ? 250 : 60,
        title: d.error ? 'Enhancement failed' : 'Enhanced prompt #' + (d.n || '?') + (d.v > 1 ? ' · v' + d.v : ''),
        meta: [model, d.effort, d.time].filter(Boolean).join(' · '),
        isSaved: !s.saving, saveText: d.error ? '' : (s.saving ? 'Saving…' : 'Saved'),
        canPaste: !d.error, paste: () => this.paste(),
        pasteTip: n ? 'Pastes the chosen images, then the prompt, into Claude' : 'Pastes the prompt into Claude',
        hasImgs: n > 0, imgCount: String(n), hasSel: s.sel.length > 0, selText: s.sel.length + ' selected',
        clearSel: () => this.setState({ sel: [] }),
        openViewBtn: () => this.openView(s.sel.length ? s.sel[0] : 0),
        copyImgsLabel: copyImgsLabel, copyImgs: () => this.copyImgs(),
        onStripWheel: (e) => { const el = e.currentTarget; if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { el.scrollLeft += e.deltaY; e.preventDefault(); } },
        thumbs: imgs.map((im, i) => {
          const on = s.sel.indexOf(i) >= 0; const ed = im.edited && !s.orig[i];
          return {
            src: ed ? im.edited : im.orig, edited: !!im.edited, selected: on, pressed: on ? 'true' : 'false',
            label: 'Image ' + (i + 1) + (im.edited ? (ed ? ' (edited)' : ' (original)') : '') + (on ? ', selected' : ''),
            border: on ? '2px solid var(--accent)' : '1px solid var(--thumb-border)',
            click: () => this.toggleSel(i), dbl: () => this.copyOriginal(i),
            editPressed: ed ? 'true' : 'false', editLabel: ed ? 'Edits on, click to use the original' : 'Edits off, click to use your edits',
            editColor: ed ? 'var(--accent)' : '#f0f0f0',
            toggleEdit: (e) => { if (e) e.stopPropagation(); this.toggleEdits(i); },
            view: (e) => { if (e) e.stopPropagation(); this.openView(i); },
            stop: (e) => { if (e) e.stopPropagation(); }
          };
        }),
        origStr: s.showOrig ? 'true' : 'false', togglePrompt: () => this.switchPrompt(),
        sw: s.showOrig ? { track: 'var(--accent)', knob: 'var(--accent-ink)', x: '14px', label: 'var(--text)' } : { track: 'var(--thumb-border)', knob: 'var(--text-2)', x: '0px', label: 'var(--muted)' },
        hasNotes: notes.length > 0, notesOpen: s.notes && notes.length > 0, noteSections: notes,
        notesStr: s.notes ? 'true' : 'false', notesBg: s.notes ? 'var(--bar-on)' : 'none',
        notesText: gapN ? gapN + (gapN === 1 ? ' gap' : ' gaps') : 'Notes',
        notesLabel: 'What changed and what is missing', toggleNotes: () => this.setState({ notes: !s.notes }),
        copyPromptLabel: s.showOrig ? 'Copy original prompt' : 'Copy prompt', copyPrompt: () => this.copyPrompt(),
        taRef: this._rf2 || (this._rf2 = (el) => { if (el && el !== this._ta) RichEdit.attach(el, { openLink: (u) => Native.call('openLink', { url: u }) }); this._ta = el; this.fill(el); }),
        origRef: this._rf3 || (this._rf3 = (el) => { this._orig = el; }),
        stripRef: this._rf4 || (this._rf4 = (el) => { this._strip = el; setTimeout(() => this.updateBars(), 30); }),
        hThumbRef: this._rf5 || (this._rf5 = (el) => { this._hth = el; setTimeout(() => this.updateBars(), 30); }),
        vThumbRef: this._rf6 || (this._rf6 = (el) => { this._vth = el; setTimeout(() => this.updateBars(), 30); }),
        onScrollShow: (ev) => this.showScrollbar(ev.currentTarget),
        onPromptInput: () => this.onPromptInput(), onTaKey: (e) => this.onTaKey(e), onRichPaste: (e) => this.onRichPaste(e),
        editable: d.error ? 'false' : 'true', taColor: d.error ? 'var(--danger)' : 'var(--text)',
        taDisp: s.anim ? 'none' : (s.showOrig ? 'none' : 'block'), origDisp: s.anim ? 'none' : (s.showOrig ? 'block' : 'none'),
        animDisp: s.anim ? 'block' : 'none', anim: this.animVals(s.anim), origText: this.original(),
        toastText: s.toast ? s.toast.text : '', toastOp: s.toast ? '1' : '0', toastY: s.toast ? '0px' : '8px',
        viewHidden: s.view ? 'false' : 'true', viewOp: s.view ? '1' : '0', viewPe: s.view ? 'auto' : 'none',
        vTop: 76, VW: W, VH: VH, SW: SW, vLabelTop: 18,
        slides: imgs.map((im, i) => {
          // Quick fade between images (no sliding).
          const x = 0; let vis = 'hidden'; let tr = 'none';
          if (i === s.idx) { vis = 'visible'; tr = s.prevIdx >= 0 ? 'opacity 160ms ease' : 'none'; }
          else if (i === s.prevIdx) { vis = 'visible'; tr = 'opacity 160ms ease'; }
          const ed = im.edited && !s.orig[i];
          return { src: ed ? im.edited : im.orig, x: x, op: i === s.idx ? '1' : '0', vis: vis, tr: tr, label: 'Image ' + (i + 1) + (im.edited ? (ed ? ', edited' : ', original') : '') };
        }),
        switchOrig: () => this.switchOrig(),
        zoneDbl: (e) => { if (e.target && e.target.closest && e.target.closest('button')) return; this.switchOrig(); },
        vLabel: cur.edited ? (curOrig ? 'Original' : 'Edited') : 'Original · no edits',
        vLabelDot: cur.edited && !curOrig ? '#ff6a5c' : 'var(--faint)',
        vCount: (s.idx + 1) + ' / ' + n,
        vHint: cur.edited ? 'Double-click the image to switch between edited and original' : 'This image has no edits',
        closeView: () => this.closeView(),
        nearL: () => this.setState({ near: 'l' }), nearR: () => this.setState({ near: 'r' }), nearOff: () => this.setState({ near: null, tip: null }),
        arrLOp: s.near === 'l' && s.idx > 0 ? '1' : '0', arrLPe: s.near === 'l' && s.idx > 0 ? 'auto' : 'none',
        arrROp: s.near === 'r' && s.idx < n - 1 ? '1' : '0', arrRPe: s.near === 'r' && s.idx < n - 1 ? 'auto' : 'none',
        prev: () => this.go(-1), next: () => this.go(1)
      };
    }
  }

  const app = new Result();
  window.__result = app;
  window.__flush = () => app.flush();
  DC.mount(document.getElementById('app'), document.getElementById('tpl').innerHTML, app);
  let resizeT = null;
  window.addEventListener('resize', () => {
    document.documentElement.classList.add('resizing'); clearTimeout(resizeT);
    resizeT = setTimeout(() => document.documentElement.classList.remove('resizing'), 150);
    app.setState({ tick: app.S().tick + 1 }); setTimeout(() => app.updateBars(), 30);
  });
  app.init();
})();
