export type ByteRange = {
  start: number;
  end: number;
};

export function parseByteRange(
  header: string | null,
  size: number
): ByteRange | null {
  if (!header) {
    return null;
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || size <= 0) {
    throw new RangeError("Rango HTTP inválido");
  }

  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd) {
    throw new RangeError("Rango HTTP vacío");
  }

  let start: number;
  let end: number;

  if (!rawStart) {
    const suffixLength = Number(rawEnd);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      throw new RangeError("Sufijo de rango inválido");
    }
    start = Math.max(size - suffixLength, 0);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd ? Number(rawEnd) : size - 1;
  }

  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    start >= size ||
    end < start
  ) {
    throw new RangeError("Rango fuera del archivo");
  }

  return { start, end: Math.min(end, size - 1) };
}
