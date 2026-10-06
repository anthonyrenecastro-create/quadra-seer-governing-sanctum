import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
// A dedicated local vault; conversation code never receives secrets.
export class CredentialStore {
  constructor(dir) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.file = path.join(dir, 'connections.enc');
    const keyFile = path.join(dir, 'vault.key');
    if (!existsSync(keyFile)) writeFileSync(keyFile, randomBytes(32), { mode: 0o600, flag: 'wx' });
    this.key = readFileSync(keyFile);
    this.data = {};
    if (existsSync(this.file)) {
      const raw = JSON.parse(readFileSync(this.file, 'utf8'));
      const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(raw.iv, 'hex'));
      decipher.setAuthTag(Buffer.from(raw.tag, 'hex'));
      this.data = JSON.parse(Buffer.concat([decipher.update(Buffer.from(raw.data, 'hex')), decipher.final()]).toString());
    }
  }
  get(id) { return this.data[id]; }
  set(id, value) { if (value) this.data[id] = value; else delete this.data[id]; this.save(); }
  save() {
    const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(JSON.stringify(this.data)), cipher.final()]);
    writeFileSync(this.file + '.tmp', JSON.stringify({ iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), data: data.toString('hex') }), { mode: 0o600 });
    renameSync(this.file + '.tmp', this.file);
  }
}
