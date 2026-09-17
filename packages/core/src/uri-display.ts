// Display only: never use decoded text as a request URL, identity, or filesystem path.
export function decodeUriForDisplay(value: string): string {
  return value.replace(/(?:%[\da-f]{2})+/gi, (encoded) => {
    try {
      return decodeURIComponent(encoded);
    } catch {
      // Older library listings also contain Latin-1 escapes, mixed with literal '%'.
      let decoded = "";
      for (let index = 0; index < encoded.length; ) {
        const byte = parseInt(encoded.slice(index + 1, index + 3), 16);
        const width =
          byte >= 0xc2 && byte <= 0xdf ? 2 : byte >= 0xe0 && byte <= 0xef ? 3 : byte >= 0xf0 && byte <= 0xf4 ? 4 : 1;
        const sequence = encoded.slice(index, index + width * 3);
        try {
          decoded += decodeURIComponent(sequence);
          index += sequence.length;
        } catch {
          decoded += String.fromCharCode(byte);
          index += 3;
        }
      }
      return decoded;
    }
  });
}

export function urlPathForDisplay(value: string): string {
  try {
    return decodeUriForDisplay(new URL(value).pathname);
  } catch {
    return decodeUriForDisplay(value);
  }
}

export function messageForDisplay(value: string | null | undefined): string {
  // Only URI spans are encoded; surrounding prose and local paths are already literal.
  return (value ?? "").replace(/\b[a-z][a-z\d+.-]*:\/\/[^\s<>"'`]+/gi, decodeUriForDisplay);
}
