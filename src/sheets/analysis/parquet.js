// Parquet through hyparquet (pure JS), one row group at a time. Snappy is
// built in; gzip, brotli, zstd and lz4 come from hyparquet-compressors
// without its WebAssembly snappy (the renderer's CSP blocks WebAssembly).

import { parquetMetadataAsync, parquetRead, parquetSchema } from 'hyparquet';
import { decompress as zstd } from 'fzstd';
import { gunzip } from 'hyparquet-compressors/src/gzip.js';
import { decompressBrotli } from 'hyparquet-compressors/src/brotli.js';
import { decompressLz4, decompressLz4Raw } from 'hyparquet-compressors/src/lz4.js';
import { ColumnBuilder, pushValue, uniqueNames } from './columns.js';

const compressors = {
  GZIP: (input, length) => gunzip(input, new Uint8Array(length)),
  BROTLI: decompressBrotli,
  ZSTD: (input) => zstd(input),
  LZ4: decompressLz4,
  LZ4_RAW: decompressLz4Raw,
};

export function asyncBuffer(reader) {
  return {
    byteLength: reader.size,
    async slice(start, end = reader.size) {
      const u8 = await reader.read(start, end - start);
      return u8.byteOffset === 0 && u8.byteLength === u8.buffer.byteLength ? u8.buffer : u8.slice().buffer;
    },
  };
}

export async function parseParquet(reader, { onProgress } = {}) {
  const file = asyncBuffer(reader);
  const metadata = await parquetMetadataAsync(file);
  const names = parquetSchema(metadata).children.map((c) => c.element.name);
  const total = Number(metadata.num_rows);
  const builders = uniqueNames(names).map((n) => new ColumnBuilder(n));
  const byName = new Map(names.map((n, i) => [n, builders[i]]));
  let rowStart = 0;
  for (const group of metadata.row_groups) {
    const rowEnd = rowStart + Number(group.num_rows);
    await parquetRead({
      file,
      metadata,
      compressors,
      rowStart,
      rowEnd,
      onChunk: ({ columnName, columnData, rowStart: from }) => {
        const b = byName.get(columnName);
        if (!b) return;
        for (let i = 0; i < columnData.length; i += 1) {
          const row = from + i;
          if (row < b.length || row >= rowEnd) continue;
          b.padTo(row);
          const v = columnData[i];
          if (typeof v === 'string') {
            if (v) b.pushString(v);
            else b.pushMissing();
          } else pushValue(b, v);
        }
      },
    });
    rowStart = rowEnd;
    onProgress?.(total ? rowStart / total : 1, rowStart);
  }
  return { columns: builders.map((b) => b.finish(total)), rows: total };
}
