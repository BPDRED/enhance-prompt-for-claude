// bridge.js: talks to the native Swift window. In a normal browser (for testing) it falls back
// to a stand-in that logs calls and returns sample data, so the pages can be checked without the app.
(function () {
  'use strict';
  const handler = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.bridge;
  const pending = {};
  let seq = 0;
  window.__nativeReply = function (id, ok, value) {
    const p = pending[id];
    if (!p) return;
    delete pending[id];
    if (ok) p.resolve(value); else p.reject(new Error(value || 'native error'));
  };
  const log = [];
  window.__nativeLog = log;
  function mock(cmd, args) {
    log.push({ cmd: cmd, args: args });
    const m = window.__mock || {};
    if (typeof m[cmd] === 'function') return Promise.resolve(m[cmd](args));
    return Promise.resolve(m[cmd] !== undefined ? m[cmd] : null);
  }
  window.Native = {
    available: !!handler,
    call: function (cmd, args) {
      if (!handler) return mock(cmd, args || {});
      return new Promise(function (resolve, reject) {
        const id = ++seq;
        pending[id] = { resolve: resolve, reject: reject };
        handler.postMessage({ id: id, cmd: cmd, args: args || {} });
      });
    }
  };
})();
