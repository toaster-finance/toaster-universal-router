export function splitHash(hash: string): string[] {
  if (hash.slice(0, 2) !== "0x" || (hash.length - 2) % 64 > 0) return [];
  hash = hash.slice(2);
  const numChunks = Math.ceil(hash.length / 64);
  const chunks = new Array(numChunks);
  for (let i = 0, o = 0; i < numChunks; ++i, o += 64) {
    chunks[i] = "0x" + hash.slice(o, o + 64);
  }
  return chunks;
}
