// richedit.js: shared behaviour for the formatted text boxes (popup prompt box and result window).
// ⌘B / ⌘I, "- " or "* " → bullet list, "1. " → numbered list, Tab / Shift+Tab nest list items, "---" + Enter → separator line,
// web addresses turn into blue links, macOS spell check underlines mistakes, pasting keeps plain text.
(function () {
  'use strict';
  const URL_RE = /(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+\.[^\s<>"']+)$/i;

  function blockOf(el, node) {
    let n = node;
    while (n && n !== el && !(n.nodeType === 1 && /^(P|DIV|LI|H[1-6]|BLOCKQUOTE)$/.test(n.tagName))) n = n.parentNode;
    return n;
  }
  function textBefore(el) {
    const sel = window.getSelection();
    if (!sel.rangeCount) return null;
    const r = sel.getRangeAt(0);
    if (!r.collapsed || !el.contains(r.startContainer)) return null;
    const b = blockOf(el, r.startContainer) || el;
    const pre = document.createRange();
    pre.setStart(b, 0); pre.setEnd(r.startContainer, r.startOffset);
    return { text: pre.toString(), block: b, range: r };
  }
  function deleteBack(n) { for (let i = 0; i < n; i++) document.execCommand('delete'); }
  function inList(el) {
    const sel = window.getSelection(); if (!sel.rangeCount) return false;
    let n = sel.getRangeAt(0).startContainer;
    while (n && n !== el) { if (n.nodeType === 1 && n.tagName === 'LI') return true; n = n.parentNode; }
    return false;
  }
  // Turns the web address that ends at (node, end) into a link. Returns the text node after it.
  function linkifyAt(el, node, end) {
    if (!node || node.nodeType !== 3 || !el.contains(node)) return null;
    let p = node.parentNode; while (p && p !== el) { if (p.tagName === 'A') return null; p = p.parentNode; }
    const m = node.nodeValue.slice(0, end).match(URL_RE);
    if (!m) return null;
    const word = document.createRange(); word.setStart(node, end - m[1].length); word.setEnd(node, end);
    const a = document.createElement('a');
    a.href = /^https?:/i.test(m[1]) ? m[1] : 'https://' + m[1];
    a.setAttribute('data-auto', '1');
    word.surroundContents(a);
    return a.nextSibling;
  }
  function linkifyBefore(el) {
    const sel = window.getSelection(); if (!sel.rangeCount) return;
    const r = sel.getRangeAt(0);
    const nx = linkifyAt(el, r.startContainer, r.startOffset);
    if (nx) { const c = document.createRange(); if (nx.nodeType === 3) c.setStart(nx, 0); else c.setStartBefore(nx); c.collapse(true); sel.removeAllRanges(); sel.addRange(c); }
  }
  // ----- links typed as web addresses follow their text -----
  const ADDR = /^(https?:\/\/[^\s<>"']+|www\.[^\s<>"'.]+\.[^\s<>"']+)$/i;
  function markAuto(el) {
    // A link whose text is its own address is an "auto" link: editing the text edits the address.
    el.querySelectorAll('a:not([data-auto])').forEach((a) => {
      const h = (a.getAttribute('href') || '').replace(/^https?:\/\//i, ''); const t = a.textContent.replace(/^https?:\/\//i, '');
      if (t && h === t) a.setAttribute('data-auto', '1');
    });
  }
  function caretOffset(el) {
    const sel = window.getSelection(); if (!sel.rangeCount || !el.contains(sel.focusNode)) return -1;
    const r = document.createRange(); r.setStart(el, 0); r.setEnd(sel.focusNode, sel.focusOffset); return r.toString().length;
  }
  function setCaret(el, n) {
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let node; let left = n; let last = null;
    while ((node = w.nextNode())) {
      last = node;
      if (left <= node.nodeValue.length) { const r = document.createRange(); r.setStart(node, left); r.collapse(true); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); return; }
      left -= node.nodeValue.length;
    }
    if (last) { const r = document.createRange(); r.setStart(last, last.nodeValue.length); r.collapse(true); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); }
  }
  function pointAt(a, idx) {
    const w = document.createTreeWalker(a, NodeFilter.SHOW_TEXT); let node; let left = idx;
    while ((node = w.nextNode())) { if (left <= node.nodeValue.length) return [node, left]; left -= node.nodeValue.length; }
    return [a, a.childNodes.length];
  }
  function moveTailOut(a, idx) {
    const r = document.createRange(); const p = pointAt(a, idx); r.setStart(p[0], p[1]); r.setEnd(a, a.childNodes.length);
    const frag = r.extractContents(); a.parentNode.insertBefore(document.createTextNode(frag.textContent), a.nextSibling);
  }
  function unwrap(a) { const t = document.createTextNode(a.textContent); a.parentNode.replaceChild(t, a); }
  function touching(a) {
    const sel = window.getSelection(); if (!sel.rangeCount) return false;
    const r = sel.getRangeAt(0); const n = r.startContainer; const o = r.startOffset;
    if (a.contains(n)) return true;
    if (n.nodeType === 3) return (o === 0 && n.previousSibling === a) || (o === n.nodeValue.length && n.nextSibling === a);
    return n.childNodes[o - 1] === a || n.childNodes[o] === a;
  }
  // final: also turn back into plain text a link whose text is no longer an address, even if the caret is on it.
  function fixLinks(el, final) {
    const links = Array.from(el.querySelectorAll('a[data-auto]')); if (!links.length) return false;
    const off = caretOffset(el); let changed = false;
    links.forEach((a) => {
      if (!a.isConnected || !a.parentNode) return;
      // letters typed right after (or right before) the link become part of it
      let nx = a.nextSibling;
      while (nx && nx.nodeType === 3) {
        const m = nx.nodeValue.match(/^[^\s<>"']+/); if (!m) break;
        a.appendChild(document.createTextNode(m[0])); nx.nodeValue = nx.nodeValue.slice(m[0].length); changed = true;
        if (nx.nodeValue) break; const d = nx; nx = nx.nextSibling; d.remove();
      }
      const pv = a.previousSibling;
      if (pv && pv.nodeType === 3) { const m = pv.nodeValue.match(/[^\s<>"'(\[]+$/); if (m) { a.insertBefore(document.createTextNode(m[0]), a.firstChild); pv.nodeValue = pv.nodeValue.slice(0, -m[0].length); changed = true; } }
      a.normalize();
      let t = a.textContent; const sp = t.search(/\s/);
      if (sp !== -1) { moveTailOut(a, sp); changed = true; t = a.textContent; }           // a space ends the link
      const pm = t.match(/[.,;:!?)\]'"]+$/);
      if (pm && pm[0].length < t.length) { moveTailOut(a, t.length - pm[0].length); changed = true; t = a.textContent; }   // closing punctuation stays outside
      if (!t) { a.remove(); changed = true; return; }
      if (ADDR.test(t)) { const h = /^https?:/i.test(t) ? t : 'https://' + t; if (a.getAttribute('href') !== h) a.setAttribute('href', h); }
      else if (final || !touching(a)) { unwrap(a); changed = true; }
    });
    if (changed && off >= 0 && el.contains(document.activeElement || el)) setCaret(el, off);
    return changed;
  }
  // ----- Tab / Shift+Tab nest list items -----
  function curLi(el) {
    const sel = window.getSelection(); if (!sel.rangeCount) return null;
    let n = sel.getRangeAt(0).startContainer;
    while (n && n !== el) { if (n.nodeType === 1 && n.tagName === 'LI') return n; n = n.parentNode; }
    return null;
  }
  function isList(n) { return n && n.nodeType === 1 && /^(UL|OL)$/.test(n.tagName); }
  // Tab: the item goes one level deeper, under the item above it (a list inside that item).
  function indentLi(li) {
    const prev = li.previousElementSibling; if (!prev) return false;
    let target;
    if (isList(prev)) target = prev;
    else if (prev.tagName === 'LI') {
      target = isList(prev.lastElementChild) ? prev.lastElementChild : null;
      if (!target) { target = document.createElement(li.parentNode.tagName); prev.appendChild(target); }
    } else return false;
    target.appendChild(li);
    return true;
  }
  // Shift+Tab: the item comes back one level; the items below it in its list stay under it.
  function outdentLi(el, li) {
    const list = li.parentNode; const holder = list.parentNode;
    if (!holder || holder === el || !(holder.tagName === 'LI' || isList(holder))) return false;
    const rest = []; let n = li.nextSibling; while (n) { rest.push(n); n = n.nextSibling; }
    if (rest.length) { const sub = isList(li.lastElementChild) ? li.lastElementChild : li.appendChild(document.createElement(list.tagName)); rest.forEach((x) => sub.appendChild(x)); }
    const after = holder.tagName === 'LI' ? holder : list;
    after.parentNode.insertBefore(li, after.nextSibling);
    if (!list.firstChild) list.remove();
    return true;
  }
  function listDepth(el, li) { let d = 0; let n = li.parentNode; while (n && n !== el) { if (/^(UL|OL)$/.test(n.tagName)) d++; n = n.parentNode; } return d; }
  function keydown(el, e, opts) {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && !e.shiftKey && (e.key === 'b' || e.key === 'B')) { e.preventDefault(); document.execCommand('bold'); return true; }
    if (mod && !e.shiftKey && (e.key === 'i' || e.key === 'I')) { e.preventDefault(); document.execCommand('italic'); return true; }
    if (e.key === 'Tab' && !mod && !e.altKey && !e.isComposing) {
      const li = curLi(el);
      if (li) {
        e.preventDefault();
        const r0 = window.getSelection().getRangeAt(0); const node = r0.startContainer; const off = r0.startOffset;   // the nodes move but stay the same
        const done = e.shiftKey ? outdentLi(el, li) : indentLi(li);   // the first item has nothing to go under; top level can't go back
        if (done) { const r = document.createRange(); r.setStart(node, off); r.collapse(true); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); el.dispatchEvent(new Event('input', { bubbles: true })); }
        return done;
      }
    }
    if (mod || e.isComposing) return false;
    if (e.key === 'Enter' && !e.shiftKey) {
      const t = textBefore(el);
      if (t && /^-{3,}$/.test(t.text.trim()) && !inList(el)) {
        e.preventDefault(); deleteBack(t.text.length);
        document.execCommand('insertHorizontalRule');
        document.execCommand('insertParagraph');
        return true;
      }
      linkifyBefore(el);
    }
    return false;
  }
  // Reacts to the text itself (typed, dictated or auto-corrected): "- " / "* " start a bullet list,
  // "1. " a numbered list, and a web address followed by a space becomes a link.
  function afterInput(el, e) {
    if (e.inputType !== 'insertText' || e.data == null || !/\s$/.test(e.data)) return false;
    const t = textBefore(el);
    if (t && !inList(el)) {
      if (/^[-*]\s$/.test(t.text)) { deleteBack(2); document.execCommand('insertUnorderedList'); return true; }
      if (/^1[.)]\s$/.test(t.text)) { deleteBack(3); document.execCommand('insertOrderedList'); return true; }
    }
    // a web address followed by the space just typed becomes a link; the caret stays after the space
    const sel = window.getSelection();
    if (sel.rangeCount) {
      const r = sel.getRangeAt(0); const n = r.startContainer; const off = r.startOffset;
      if (n.nodeType === 3 && off > 0) {
        const nx = linkifyAt(el, n, off - 1);
        if (nx && nx.nodeType === 3) { const c = document.createRange(); c.setStart(nx, Math.min(1, nx.nodeValue.length)); c.collapse(true); sel.removeAllRanges(); sel.addRange(c); }
      }
    }
    return false;
  }
  function attach(el, opts) {
    opts = opts || {};
    el.setAttribute('spellcheck', 'true');
    el.addEventListener('beforeinput', () => markAuto(el));
    el.addEventListener('input', (e) => { const a1 = afterInput(el, e); const a2 = e.isComposing ? false : fixLinks(el, false); if ((a1 || a2) && opts.onChange) opts.onChange(); });
    el.addEventListener('blur', () => { markAuto(el); if (fixLinks(el, true) && opts.onChange) opts.onChange(); });
    // When the caret leaves a link that is no longer an address, it turns back into plain text.
    let selT = null;
    document.addEventListener('selectionchange', () => {
      clearTimeout(selT);
      selT = setTimeout(() => {
        const sel = window.getSelection();
        if (!sel.rangeCount || !sel.isCollapsed || !el.contains(sel.anchorNode)) return;
        if (fixLinks(el, false) && opts.onChange) opts.onChange();
      }, 250);
    });
    el.addEventListener('keydown', (e) => { if (keydown(el, e, opts) && opts.onChange) opts.onChange(); });
    // Clicking a link opens it. A double-click (to select and edit it) or a drag-select does not.
    let openT = null;
    el.addEventListener('click', (e) => {
      const a = e.target && e.target.closest && e.target.closest('a');
      clearTimeout(openT);
      if (!a) return;
      e.preventDefault();   // never let the page itself navigate away
      if (!opts.openLink || e.button !== 0 || e.detail > 1) return;
      if (e.metaKey || e.ctrlKey) { e.preventDefault(); opts.openLink(a.href); return; }
      const sel = window.getSelection(); if (sel && !sel.isCollapsed) return;
      openT = setTimeout(() => { const s2 = window.getSelection(); if (s2 && !s2.isCollapsed) return; opts.openLink(a.href); }, 280);
    });
    el.addEventListener('dblclick', () => clearTimeout(openT));
  }
  function pastePlain(e) {
    const t = e.clipboardData && e.clipboardData.getData('text/plain');
    if (t == null) return false;
    e.preventDefault();
    document.execCommand('insertText', false, t);
    return true;
  }
  function isEmpty(el) { return !el || (!el.textContent.trim() && !el.querySelector('hr, li, img')); }
  function caretToEnd(el) {
    const r = document.createRange(); r.selectNodeContents(el); r.collapse(false);
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  }
  window.RichEdit = { attach: attach, fixLinks: (el) => { markAuto(el); return fixLinks(el, true); }, pastePlain: pastePlain, isEmpty: isEmpty, caretToEnd: caretToEnd };
})();
