import { spawn, execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';

export class RpcProcess {
  constructor(command, args, { cwd, env, onEvent = () => {}, onRequest = async () => { throw new Error('不支持的代理请求'); } } = {}) {
    this.child = spawn(command, args, { cwd, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.serial = 0; this.pending = new Map(); this.closed = false; this.stderr = '';
    this.lines = createInterface({ input: this.child.stdout, crlfDelay: Infinity });
    this.lines.on('line', async (line) => {
      let message;
      try { message = JSON.parse(line); } catch { return; }
      if (message.method && message.id !== undefined) {
        try { this.write({ jsonrpc: '2.0', id: message.id, result: await onRequest(message.method, message.params || {}) }); }
        catch (error) { this.write({ jsonrpc: '2.0', id: message.id, error: { code: -32603, message: error.message } }); }
      } else if (message.id !== undefined) {
        const call = this.pending.get(message.id);
        if (call) { clearTimeout(call.timer); this.pending.delete(message.id); message.error ? call.reject(new Error(message.error.message + (message.error.data ? '：' + JSON.stringify(message.error.data) : ''))) : call.resolve(message.result); }
      } else if (message.method) { try { onEvent(message.method, message.params || {}); } catch (error) { onEvent('transport/error', { message: error.message }); } }
    });
    this.child.stderr.on('data', (bytes) => { this.stderr = (this.stderr + bytes).slice(-12000); });
    const closed = (error) => {
      this.closed = true;
      for (const call of this.pending.values()) { clearTimeout(call.timer); call.reject(error); }
      this.pending.clear(); onEvent('transport/closed', { message: error.message });
    };
    this.child.on('error', closed);
    this.child.on('close', (code) => closed(new Error(`代理连接已关闭（${code}）${this.stderr ? '：' + this.stderr.slice(-1800) : ''}`)));
  }
  write(message) { if (!this.closed && !this.child.stdin.destroyed) this.child.stdin.write(JSON.stringify(message) + '\n'); }
  call(method, params = {}, timeout = 90000) {
    if (this.closed) return Promise.reject(new Error('代理连接已断开'));
    const id = ++this.serial;
    return new Promise((resolve, reject) => {
      const timer = timeout ? setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} 请求超时`)); }, timeout) : null;
      this.pending.set(id, { resolve, reject, timer }); this.write({ jsonrpc: '2.0', id, method, params });
    });
  }
  notify(method, params = {}) { this.write({ jsonrpc: '2.0', method, params }); }
  close() { this.child.stdin.end(); const timer = setTimeout(() => this.kill(), 3000); timer.unref(); }
  kill() {
    if (this.closed) return;
    if (process.platform === 'win32' && this.child.pid) {
      try { execFileSync('taskkill', ['/PID', String(this.child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); return; } catch {}
    }
    this.child.kill();
  }
}
