export async function readJsonSafe(res) {
  try {
    const text = await res.text().catch(() => '');
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      return {
        ok: false,
        error: (text || '').slice(0, 200) || 'Invalid JSON response',
      };
    }
  } catch (e) {
    return { ok: false, error: e?.message || 'Failed to read response' };
  }
}

