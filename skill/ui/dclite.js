// dclite.js: a tiny renderer for the design-board template format ({{holes}}, <sc-for>, <sc-if>,
// camelCase event attributes, ref callbacks). It lets the popup and result window keep the
// approved board markup almost unchanged. No dependencies, works offline.
(function () {
  'use strict';

  class DCLogic {
    constructor() { this.state = {}; }
    setState(patch) {
      this.state = Object.assign({}, this.state, patch);
      if (this.__schedule) this.__schedule();
    }
  }

  // ---------- template compile ----------
  const HOLE = /\{\{([\s\S]*?)\}\}/g;
  function parseParts(str) {
    const parts = [];
    let last = 0; let m;
    HOLE.lastIndex = 0;
    while ((m = HOLE.exec(str))) {
      if (m.index > last) parts.push(str.slice(last, m.index));
      parts.push({ expr: m[1].trim() });
      last = m.index + m[0].length;
    }
    if (last < str.length) parts.push(str.slice(last));
    return parts;
  }
  function hasHole(str) { HOLE.lastIndex = 0; return HOLE.test(str); }

  const EVENT_MAP = {
    ondoubleclick: 'dblclick', onclick: 'click', onmousedown: 'mousedown', onmouseup: 'mouseup',
    onmouseenter: 'mouseenter', onmouseleave: 'mouseleave', onmousemove: 'mousemove',
    onpointerdown: 'pointerdown', onpointermove: 'pointermove', onpointerup: 'pointerup', onpointercancel: 'pointercancel',
    onkeydown: 'keydown', onkeyup: 'keyup', oninput: 'input', onblur: 'blur', onfocus: 'focus',
    onwheel: 'wheel', onscroll: 'scroll', onpaste: 'paste', oncontextmenu: 'contextmenu',
    ondragover: 'dragover', ondrop: 'drop', ondragleave: 'dragleave', oncompositionend: 'compositionend'
  };

  function compileNode(n) {
    if (n.nodeType === 3) {
      const t = n.nodeValue;
      if (!hasHole(t)) return { k: 'text', parts: [t] };
      return { k: 'text', parts: parseParts(t) };
    }
    if (n.nodeType !== 1) return null;
    const tag = n.localName;
    if (tag === 'sc-for') {
      return { k: 'for', list: parseParts(n.getAttribute('list') || '')[0], as: n.getAttribute('as') || 'item', children: compileChildren(n) };
    }
    if (tag === 'sc-if') {
      return { k: 'if', value: parseParts(n.getAttribute('value') || '')[0], children: compileChildren(n) };
    }
    const attrs = [];
    for (const a of Array.from(n.attributes)) {
      if (a.name.indexOf('hint-') === 0) continue;
      attrs.push({ name: a.name, parts: parseParts(a.value) });
    }
    return { k: 'el', tag: tag, ns: n.namespaceURI, attrs: attrs, children: compileChildren(n) };
  }
  function compileChildren(n) {
    const src = n.localName === 'template' ? n.content : n;
    const out = [];
    for (const c of Array.from(src.childNodes)) {
      const x = compileNode(c);
      if (x) out.push(x);
    }
    return out;
  }
  function compile(html) {
    const t = document.createElement('template');
    t.innerHTML = html;
    return compileChildren(t);
  }

  // ---------- evaluate ----------
  function lookup(scope, expr) {
    if (expr === 'true') return true;
    if (expr === 'false') return false;
    if (expr === 'null') return null;
    if (/^-?\d+(\.\d+)?$/.test(expr)) return Number(expr);
    if (/^'.*'$|^".*"$/.test(expr)) return expr.slice(1, -1);
    const path = expr.split('.');
    let s = scope; let v;
    while (s) {
      if (Object.prototype.hasOwnProperty.call(s.vars, path[0])) { v = s.vars[path[0]]; break; }
      s = s.parent;
    }
    for (let i = 1; i < path.length; i++) v = v == null ? undefined : v[path[i]];
    return v;
  }
  function evalParts(parts, scope) {
    if (parts.length === 1 && typeof parts[0] !== 'string') return lookup(scope, parts[0].expr);
    let out = '';
    for (const p of parts) {
      if (typeof p === 'string') out += p;
      else { const v = lookup(scope, p.expr); out += v == null ? '' : String(v); }
    }
    return out;
  }

  // ---------- render to virtual nodes ----------
  function renderList(nodes, scope) {
    const out = [];
    for (const n of nodes) {
      if (n.k === 'text') out.push({ k: 'text', text: String(evalParts(n.parts, scope) ?? '') });
      else if (n.k === 'el') {
        const props = {};
        for (const a of n.attrs) props[a.name] = evalParts(a.parts, scope);
        out.push({ k: 'el', tag: n.tag, ns: n.ns, props: props, children: renderList(n.children, scope) });
      } else if (n.k === 'if') {
        const v = n.value && typeof n.value !== 'string' ? lookup(scope, n.value.expr) : false;
        out.push({ k: 'frag', children: v ? renderList(n.children, scope) : [] });
      } else if (n.k === 'for') {
        const list = n.list && typeof n.list !== 'string' ? (lookup(scope, n.list.expr) || []) : [];
        const items = [];
        for (let i = 0; i < list.length; i++) {
          const vars = {}; vars[n.as] = list[i];
          items.push({ k: 'frag', children: renderList(n.children, { vars: vars, parent: scope }) });
        }
        out.push({ k: 'frag', children: items });
      }
    }
    return out;
  }

  // ---------- DOM create / patch ----------
  const pendingRefs = [];
  function setProp(el, name, v, old) {
    if (name === 'ref') { if (v !== old) { el.__ref = v; pendingRefs.push([v, el]); } return; }
    if (name === 'innerhtml') { if (el.__ih !== v) { el.__ih = v; el.innerHTML = v == null ? '' : String(v); } return; }
    if (name === 'autofocus') { if (v && !el.__af) { el.__af = true; setTimeout(() => { try { el.focus(); } catch (e) {} }, 0); } return; }
    if (name === 'value' && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) {
      const s = v == null ? '' : String(v);
      if (el.value !== s) el.value = s;
      return;
    }
    const ev = EVENT_MAP[name] || (name === 'onchange' ? ((el.tagName === 'INPUT' && el.type !== 'color' && el.type !== 'checkbox') || el.tagName === 'TEXTAREA' ? 'input' : 'change') : null);
    if (ev) {
      if (name === 'onchange' && el.tagName === 'INPUT' && el.type === 'color') {
        // A colour well reports both while dragging (input) and on close (change).
        if (!el.__h) el.__h = {};
        el.__h.input = v; el.__h.change = v;
        if (!el.__hl) { el.__hl = {}; }
        ['input', 'change'].forEach((t) => { if (!el.__hl[t]) { el.__hl[t] = true; el.addEventListener(t, (e) => { const f = el.__h[t]; if (typeof f === 'function') f(e); }); } });
        return;
      }
      if (!el.__h) el.__h = {};
      el.__h[ev] = v;
      if (!el.__hl) el.__hl = {};
      if (!el.__hl[ev]) {
        el.__hl[ev] = true;
        const opts = (ev === 'wheel' || ev === 'scroll') ? { passive: ev === 'scroll' } : undefined;
        el.addEventListener(ev, (e) => { const f = el.__h[ev]; if (typeof f === 'function') f(e); }, opts);
      }
      return;
    }
    let attr = name;
    if (name === 'classname') attr = 'class';
    if (v === false || v == null) { el.removeAttribute(attr); return; }
    if (v === true) { el.setAttribute(attr, attr === 'spellcheck' ? 'true' : ''); return; }
    const s = String(v);
    if (el.getAttribute(attr) !== s) el.setAttribute(attr, s);
  }

  function create(v) {
    if (v.k === 'text') { v.dom = document.createTextNode(v.text); return v.dom; }
    if (v.k === 'frag') {
      const f = document.createDocumentFragment();
      v.dom = document.createComment('['); v.end = document.createComment(']');
      f.appendChild(v.dom);
      for (const c of v.children) f.appendChild(create(c));
      f.appendChild(v.end);
      return f;
    }
    const el = v.ns && v.ns !== 'http://www.w3.org/1999/xhtml' ? document.createElementNS(v.ns, v.tag) : document.createElement(v.tag);
    v.dom = el;
    for (const k in v.props) setProp(el, k, v.props[k], undefined);
    for (const c of v.children) el.appendChild(create(c));
    return el;
  }
  function firstNode(v) { return v.dom; }
  function removeV(parent, v) {
    callRefsNull(v);
    if (v.k === 'frag') {
      let n = v.dom;
      while (n) { const next = n.nextSibling; parent.removeChild(n); if (n === v.end) break; n = next; }
    } else if (v.dom && v.dom.parentNode) v.dom.parentNode.removeChild(v.dom);
  }
  function callRefsNull(v) {
    if (v.k === 'el' && v.props && typeof v.props.ref === 'function') { try { v.props.ref(null); } catch (e) {} }
    if (v.children) v.children.forEach(callRefsNull);
  }
  function patch(parent, o, n) {
    if (o.k !== n.k || (o.k === 'el' && (o.tag !== n.tag || o.ns !== n.ns))) {
      const node = create(n);
      parent.insertBefore(node, firstNode(o));
      removeV(parent, o);
      return;
    }
    if (o.k === 'text') {
      n.dom = o.dom;
      if (o.text !== n.text) o.dom.nodeValue = n.text;
      return;
    }
    if (o.k === 'frag') {
      n.dom = o.dom; n.end = o.end;
      patchChildren(parent, o.children, n.children, o.end);
      return;
    }
    const el = o.dom; n.dom = el;
    const op = o.props; const np = n.props;
    for (const k in np) if (np[k] !== op[k]) setProp(el, k, np[k], op[k]);
    for (const k in op) if (!(k in np)) setProp(el, k, null, op[k]);
    patchChildren(el, o.children, n.children, null);
  }
  function patchChildren(parent, oc, nc, before) {
    const m = Math.min(oc.length, nc.length);
    for (let i = 0; i < m; i++) patch(parent, oc[i], nc[i]);
    for (let i = m; i < nc.length; i++) parent.insertBefore(create(nc[i]), before);
    for (let i = m; i < oc.length; i++) removeV(parent, oc[i]);
  }
  function flushRefs() {
    while (pendingRefs.length) {
      const [fn, el] = pendingRefs.shift();
      if (typeof fn === 'function') { try { fn(el); } catch (e) { console.error(e); } }
    }
  }

  function mount(root, html, comp) {
    const tree = compile(html);
    let vnodes = null; let queued = false;
    const render = () => {
      queued = false;
      let vals;
      try { vals = comp.renderVals(); } catch (e) { console.error('renderVals failed', e); return; }
      const next = renderList(tree, { vars: vals, parent: null });
      if (!vnodes) { for (const v of next) root.appendChild(create(v)); }
      else patchChildren(root, vnodes, next, null);
      vnodes = next;
      flushRefs();
      if (comp.didRender) { try { comp.didRender(); } catch (e) { console.error(e); } }
    };
    comp.__schedule = () => { if (!queued) { queued = true; Promise.resolve().then(render); } };
    comp.__renderNow = render;
    render();
    return comp;
  }

  window.DCLogic = DCLogic;
  window.DC = { mount: mount, compile: compile };
})();
