import { constants } from 'node:fs';
import { open, lstat, realpath, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
const fail = code => { throw Object.assign(new Error(code), { code }); };
const same = (a, b) => a.dev === b.dev && a.ino === b.ino;
const pause = (ms, signal) => new Promise((resolve, reject) => {
  const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(Object.assign(new Error('cancelled'), { code: 'cancelled' })); };
  const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
});
async function inspect(target) {
  const before = await lstat(target);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > 65536) fail('unsafe_repository_lock');
  const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!same(before, stat) || !stat.isFile() || stat.nlink !== 1 || stat.size > 65536) fail('unsafe_repository_lock');
    const bytes = Buffer.alloc(65537);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead > 65536) fail('unsafe_repository_lock');
    return { stat, text: bytes.subarray(0, bytesRead).toString('utf8') };
  } finally { await handle.close(); }
}
export async function acquireRegistrationLock(root, { signal, timeoutMs = 300000 } = {}) {
  if (Object.hasOwn(process.env, 'DECAL_SESSION_ID')) fail('native_writer_required');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 300000) fail('invalid_wait_limit');
  if (await realpath(root) !== root) fail('noncanonical_root');
  const target = path.join(root, '.decal-slice-completion.lock');
  const owner = JSON.stringify({ schema: 'decal.repository-lock/v1', pid: process.pid, token: randomUUID() }) + '\n';
  const start = performance.now();
  let delay = 40;
  let encountered = false;
  for (;;) {
    if (signal?.aborted) fail('cancelled');
    if (encountered && performance.now() - start >= timeoutMs) fail('repository_lock_timeout');
    let handle;
    try { handle = await open(target, 'wx', 0o600); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    if (handle) {
      try {
        await handle.writeFile(owner); await handle.sync();
        const identity = await handle.stat();
        let released = false;
        const release = async () => {
          if (released) return;
          released = true;
          try {
            const current = await inspect(target);
            const latest = await lstat(target);
            if (same(identity, current.stat) && same(identity, latest) && current.text === owner) await unlink(target);
          } catch (error) { if (error.code !== 'ENOENT') throw error; }
          finally { await handle.close(); }
        };
        if (signal?.aborted) { await release(); fail('cancelled'); }
        return release;
      } catch (error) { await handle.close().catch(() => {}); throw error; }
    }
    encountered = true;
    let malformed = false;
    try {
      const current = await inspect(target);
      let record;
      try { record = JSON.parse(current.text); } catch { malformed = true; }
      if (!Number.isSafeInteger(record?.pid) || record.pid < 1) malformed = true;
      if (!malformed) {
        try { process.kill(record.pid, 0); }
        catch (error) { if (error.code === 'ESRCH') fail('repository_lock_owner_terminated'); }
      }
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      if (['ELOOP', 'EISDIR'].includes(error.code)) fail('unsafe_repository_lock');
      throw error;
    }
    const remaining = timeoutMs - (performance.now() - start);
    if (remaining <= 0) fail(malformed ? 'unsafe_repository_lock' : 'repository_lock_timeout');
    await pause(Math.min(delay, remaining), signal);
    delay = Math.min(delay * 2, 2000);
  }
}
