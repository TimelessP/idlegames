export function createOpenAiCompatClient({ baseUrl, apiKey, defaultTimeoutMs = 120000 } = {}) {
  const normalizedBaseUrl = String(baseUrl || '').replace(/\/$/, '');

  function buildHeaders(extra = {}) {
    const headers = { 'Content-Type': 'application/json', ...extra };
    const token = String(apiKey || '').trim();
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
  }

  function buildUrl(path) {
    const safePath = String(path || '').startsWith('/') ? String(path || '') : `/${path || ''}`;
    return `${normalizedBaseUrl}${safePath}`;
  }

  function attachAbort(source, controller) {
    if (!source) return null;
    if (source.aborted) {
      controller.abort();
      return null;
    }
    const onAbort = () => controller.abort();
    source.addEventListener('abort', onAbort, { once: true });
    return () => source.removeEventListener('abort', onAbort);
  }

  async function request(path, { method = 'POST', body = null, headers = {}, timeoutMs = defaultTimeoutMs, signal = null } = {}) {
    const controller = new AbortController();
    const detach = attachAbort(signal, controller);
    const timerId = timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const payload = body == null ? undefined : JSON.stringify(body);
      return await fetch(buildUrl(path), {
        method,
        body: payload,
        headers: buildHeaders(headers),
        signal: controller.signal
      });
    } finally {
      if (timerId) clearTimeout(timerId);
      if (detach) detach();
    }
  }

  async function readPayload(res) {
    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    if (contentType.includes('text/event-stream')) {
      const reader = res.body && res.body.getReader ? res.body.getReader() : null;
      if (!reader) return { output: [], output_text: '' };
      const decoder = new TextDecoder();
      let buffer = '';
      const payload = { output: [], output_text: '' };
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (let line of lines) {
          line = line.trim();
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (!data || data === '[DONE]') {
            if (data === '[DONE]') return payload;
            continue;
          }
          try {
            const json = JSON.parse(data);
            if (typeof json.output_text === 'string') payload.output_text += json.output_text;
            if (Array.isArray(json.output)) payload.output.push(...json.output);
            else if (json.output && typeof json.output === 'object') payload.output.push(json.output);
            if (payload.output.some((item) => item && (item.type === 'tool_call' || item.type === 'function_call'))) {
              return payload;
            }
          } catch {
            continue;
          }
        }
      }
      return payload;
    }
    try {
      return await res.json();
    } catch {
      return {};
    }
  }

  return { request, readPayload };
}
