import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

export interface ExportField { path: string; value?: string; note?: string }
export interface ExportRow { formid: string; type: string; editorid: string; winner: string; fields: ExportField[] }
export interface ExportManifest { housecarl_artifact: number; row_count: number; epoch: string }
export interface ExportFile { manifest: ExportManifest; rows: ExportRow[] }

export async function readExport(file: string): Promise<ExportFile> {
  const lines = createInterface({ input: createReadStream(file, 'utf8'), crlfDelay: Infinity });
  let manifest: ExportManifest | undefined;
  const rows: ExportRow[] = [];
  const identities = new Set<string>();
  for await (const line of lines) {
    if (!line.trim()) continue;
    const parsed: unknown = JSON.parse(line.replace(/^\uFEFF/, ''));
    if (!manifest) {
      manifest = parsed as ExportManifest;
      if (manifest.housecarl_artifact !== 1 || !Number.isSafeInteger(manifest.row_count) || typeof manifest.epoch !== 'string') {
        throw new TypeError(`Invalid export manifest: ${file}`);
      }
    } else {
      const row = parsed as ExportRow;
      if (typeof row.formid !== 'string' || typeof row.winner !== 'string' || !Array.isArray(row.fields)) throw new TypeError(`Invalid row: ${file}`);
      if (identities.has(row.formid.toLowerCase())) throw new TypeError(`Duplicate record: ${row.formid}`);
      identities.add(row.formid.toLowerCase());
      rows.push(row);
    }
  }
  if (!manifest || rows.length !== manifest.row_count) throw new TypeError(`Export row count mismatch: ${file}`);
  return { manifest, rows };
}
