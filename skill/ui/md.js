// md.js: small Markdown ⇄ HTML converter for the result window. The prompt is stored as Markdown,
// shown formatted (lists, bold, italic, headings, code) and copied as both rich text and Markdown,
// so pasting into the Claude chat keeps the formatting.
(function () {
  'use strict';
  function esc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function inlineFmt(s) {
    const codes = [];
    s = esc(s).replace(/`([^`]+)`/g, (m, c) => { codes.push(c); return '\u0000' + (codes.length - 1) + '\u0000'; });
    s = s.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>').replace(/__([^_]+?)__/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\*)/g, '$1<em>$2</em>').replace(/(^|[^_\w])_([^_\s][^_]*?)_(?!\w)/g, '$1<em>$2</em>');
    s = s.replace(/~~([^~]+)~~/g, '<s>$1</s>');
    // Links: [text](url) and bare web addresses, shown in blue.
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>');
    s = s.replace(/(^|[\s(])((?:https?:\/\/|www\.)[^\s<]+[^\s<.,;:!?)])/g, (m, pre, u) => pre + '<a href="' + (/^https?:/i.test(u) ? u : 'https://' + u) + '">' + u + '</a>');
    return s.replace(/\u0000(\d+)\u0000/g, (m, i) => '<code>' + codes[+i] + '</code>');
  }
  // literal: the HTML used for pasting into the Claude chat box. Its box keeps real lists but drops bold,
  // italic and headings, so those stay as Markdown text (**bold**, *italic*, ## heading), which Claude reads.
  function mdToHtml(md, literal) {
    const inline = literal ? esc : inlineFmt;
    const lines = String(md || '').replace(/\r\n?/g, '\n').split('\n');
    const out = []; let para = []; let stack = []; // open lists, outermost first: {type, indent, items: [{text, kids: [list]}]}
    const flushPara = () => { if (para.length) { out.push('<p>' + para.map(inline).join('<br>') + '</p>'); para = []; } };
    const render = (l) => '<' + l.type + '>' + l.items.map((it) => '<li>' + inline(it.text) + it.kids.map(render).join('') + '</li>').join('') + '</' + l.type + '>';
    const flushList = () => { if (stack.length) out.push(render(stack[0])); stack = []; };
    const addItem = (indent, type, text) => {
      let top = stack[stack.length - 1];
      if (top && indent >= top.indent + 2 && top.items.length) {           // deeper: a list inside the last item
        const l = { type: type, indent: indent, items: [] }; top.items[top.items.length - 1].kids.push(l); stack.push(l); top = l;
      } else {
        while (stack.length > 1 && indent <= stack[stack.length - 1].indent - 2) stack.pop();   // back out to the right level
        top = stack[stack.length - 1];
        if (top && top.type !== type) {
          if (stack.length === 1) { flushList(); top = null; }
          else { stack.pop(); const parent = stack[stack.length - 1]; const l = { type: type, indent: indent, items: [] }; parent.items[parent.items.length - 1].kids.push(l); stack.push(l); top = l; }
        }
        if (!top) { top = { type: type, indent: indent, items: [] }; stack = [top]; }
      }
      top.items.push({ text: text, kids: [] });
    };
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      if (/^\s*```/.test(raw)) {
        flushPara(); flushList();
        const buf = []; i++;
        while (i < lines.length && !/^\s*```/.test(lines[i])) { buf.push(lines[i]); i++; }
        if (literal) out.push('<p>' + [raw.trim()].concat(buf, ['```']).map(esc).join('<br>') + '</p>');
        else out.push('<pre><code>' + esc(buf.join('\n')) + '</code></pre>');
        continue;
      }
      if (!raw.trim()) { flushPara(); flushList(); continue; }
      if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(raw)) { flushPara(); flushList(); out.push(literal ? '<p>---</p>' : '<hr>'); continue; }
      let m;
      if ((m = raw.match(/^(#{1,6})\s+(.*)$/))) { flushPara(); flushList(); const n = Math.min(3, m[1].length); out.push(literal ? '<p>' + esc(raw.trim()) + '</p>' : '<h' + n + '>' + inline(m[2]) + '</h' + n + '>'); continue; }
      if ((m = raw.match(/^>\s?(.*)$/))) { flushPara(); flushList(); out.push(literal ? '<p>' + esc(raw.trim()) + '</p>' : '<blockquote>' + inline(m[1]) + '</blockquote>'); continue; }
      const ul = raw.match(/^(\s*)[-*+]\s+(.*)$/); const ol = raw.match(/^(\s*)\d+[.)]\s+(.*)$/);
      if (ul || ol) {
        flushPara();
        const mm = ul || ol; const indent = mm[1].replace(/\t/g, '    ').length;
        addItem(indent, ul ? 'ul' : 'ol', mm[2]);
        continue;
      }
      if (stack.length && /^\s{2,}\S/.test(raw)) { const l = stack[stack.length - 1]; l.items[l.items.length - 1].text += ' ' + raw.trim(); continue; }
      flushList();
      para.push(raw);
    }
    flushPara(); flushList();
    return out.join('');
  }
  function htmlToMd(root) {
    const BLOCK = /^(DIV|P|UL|OL|HR|H[1-6]|PRE|BLOCKQUOTE)$/;
    function kids(n, ctx) { let s = ''; n.childNodes.forEach((c) => { if (c.nodeType === 1 && BLOCK.test(c.tagName) && s && !s.endsWith('\n') && !(n.tagName === 'LI' && /^(UL|OL)$/.test(c.tagName))) s += '\n'; s += walk(c, ctx); }); return s; }
    function walk(n, ctx) {
      if (n.nodeType === 3) return n.nodeValue.replace(/ /g, ' ');
      if (n.nodeType !== 1) return '';
      const t = n.tagName.toLowerCase();
      if (t === 'br') return '\n';
      if (t === 'hr') return '\n---\n\n';
      if (t === 'a' && n.hasAttribute('data-auto')) return kids(n, ctx);   // a typed web address: its text is the link
      if (t === 'a') { const x = kids(n, ctx); const h = n.getAttribute('href') || ''; const bare = h.replace(/^https?:\/\//, ''); return (!h || x === h || x === bare || 'https://' + x === h) ? x : '[' + x + '](' + h + ')'; }
      if (t === 'strong' || t === 'b') { const x = kids(n, ctx); return x.trim() ? '**' + x + '**' : x; }
      if (t === 'em' || t === 'i') { const x = kids(n, ctx); return x.trim() ? '*' + x + '*' : x; }
      if (t === 's' || t === 'strike' || t === 'del') return '~~' + kids(n, ctx) + '~~';
      if (t === 'code') return n.parentNode && n.parentNode.tagName && n.parentNode.tagName.toLowerCase() === 'pre' ? n.textContent : '`' + n.textContent + '`';
      if (t === 'pre') return '\n```\n' + n.textContent.replace(/\n$/, '') + '\n```\n\n';
      if (/^h[1-6]$/.test(t)) return '\n' + '#'.repeat(+t[1]) + ' ' + kids(n, ctx).trim() + '\n\n';
      if (t === 'blockquote') return '\n> ' + kids(n, ctx).trim() + '\n\n';
      if (t === 'ul' || t === 'ol') {
        const depth = (ctx.depth || 0); let i = 0; let s = depth ? '\n' : '\n';
        n.childNodes.forEach((c) => {
          if (c.nodeType === 1 && /^(ul|ol)$/i.test(c.tagName)) { s += walk(c, { depth: depth + 1 }).replace(/^\n+/, ''); return; }
          if (c.nodeType !== 1 || c.tagName.toLowerCase() !== 'li') return;
          i++;
          const body = kids(c, { depth: depth + 1 }).replace(/^\n+/, '').replace(/\n+$/, '');
          s += '   '.repeat(depth) + (t === 'ol' ? i + '. ' : '- ') + body + '\n';
        });
        return s + (depth ? '' : '\n');
      }
      if (t === 'li') return kids(n, ctx) + '\n';
      if (t === 'p') return kids(n, ctx) + '\n\n';
      if (t === 'div') { const x = kids(n, ctx); return (x.endsWith('\n') ? x : x + '\n'); }
      return kids(n, ctx);
    }
    return walk(root, {}).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '').replace(/\s+$/, '');
  }
  window.MD = { mdToHtml: (md) => mdToHtml(md, false), mdToPasteHtml: (md) => mdToHtml(md, true), htmlToMd: htmlToMd };
})();
