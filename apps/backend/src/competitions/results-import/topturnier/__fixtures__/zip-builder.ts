import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";
import { crc32, deflateRawSync } from "zlib";

/** Test helper: writes a ZIP archive, including deliberately broken ones. */
export interface ZipEntrySpec {
  name: string;
  content?: Buffer | string;
  /** 0 = stored, 8 = deflate (default), anything else for the tests. */
  method?: number;
  /** Unix mode in the external attributes (e.g. 0o120777 for a symlink). */
  unixMode?: number;
  flags?: number;
  /** Uncompressed size written in the headers (default: the real one). */
  declaredSize?: number;
  crc?: number;
}

export function buildZip(entries: ZipEntrySpec[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const content = Buffer.isBuffer(entry.content)
      ? entry.content
      : Buffer.from(entry.content ?? "", "utf8");
    const method = entry.method ?? 8;
    const data = method === 8 ? deflateRawSync(content) : content;
    const name = Buffer.from(entry.name, "utf8");
    const crc = entry.crc ?? crc32(content);
    const size = entry.declaredSize ?? content.length;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(entry.flags ?? 0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt8(20, 4);
    central.writeUInt8(entry.unixMode === undefined ? 0 : 3, 5);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(entry.flags ?? 0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(((entry.unixMode ?? 0) << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

/** Every file under `dir`, as zip entries (optionally under a folder). */
export function zipDirectory(dir: string, prefix = ""): Buffer {
  const entries: ZipEntrySpec[] = [];
  const walk = (current: string) => {
    for (const name of readdirSync(current).sort()) {
      const full = join(current, name);
      if (statSync(full).isDirectory()) walk(full);
      else
        entries.push({
          name: prefix + relative(dir, full).split("\\").join("/"),
          content: readFileSync(full),
        });
    }
  };
  walk(dir);
  return buildZip(entries);
}

export const EXEMPLEVILLE_EXPORT = join(__dirname, "export-exempleville");
