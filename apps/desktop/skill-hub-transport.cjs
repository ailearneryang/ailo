const { Readable } = require('node:stream');
// Electron net.fetch rejects manual redirects instead of exposing their response.
// Expose one HTTP hop using ClientRequest so SkillHub can validate every Location.
function createSkillHubTransport(getElectron = () => require('electron')) {
  return async (input, { signal } = {}) => {
    const { app, net } = getElectron();
    await app.whenReady();
    signal?.throwIfAborted();
    return new Promise((resolve, reject) => {
      const request = net.request({url: String(input), method:'GET', redirect:'manual', credentials:'omit', useSessionCookies:false, cache:'no-store', bypassCustomProtocolHandlers:true});
      let settled = false, incoming;
      const cleanup = () => signal?.removeEventListener('abort', abort);
      const fail = error => {
        cleanup();
        if (!settled) { settled = true; reject(error); }
        else if (incoming && !incoming.destroyed) incoming.destroy(error);
      };
      const abort = () => { fail(signal.reason || new Error('SkillHub 请求已取消。')); request.abort(); };
      request.on('error', fail);
      request.on('redirect', (status, method, location) => {
        if (settled) return;
        // Resolve before abort: Chromium emits "Redirect was cancelled" afterwards.
        settled = true; cleanup();
        resolve(new Response(null, {status, headers:{location}}));
        request.abort();
      });
      request.on('response', response => {
        if (settled) { response.destroy(); return; }
        incoming = response;
        response.once('end', cleanup);
        response.once('error', cleanup);
        response.once('close', () => { cleanup(); if (!response.complete && !response.readableEnded) request.abort(); });
        response.once('aborted', () => response.destroy(new Error('SkillHub 下载连接中断。')));
        const headers = new Headers();
        for (const [key, value] of Object.entries(response.headers)) for (const entry of Array.isArray(value) ? value : [value]) headers.append(key, entry);
        try {
          const empty = [204,205,304].includes(response.statusCode);
          const result = new Response(empty ? null : Readable.toWeb(response), {status:response.statusCode, headers});
          settled = true; resolve(result);
          if (empty) { cleanup(); request.abort(); }
        } catch (error) { fail(error); request.abort(); }
      });
      signal?.addEventListener('abort', abort, {once:true});
      if (signal?.aborted) abort(); else request.end();
    });
  };
}
module.exports = {createSkillHubTransport};
