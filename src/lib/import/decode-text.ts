/**
 * Encoding-tolerant text decode for uploaded reports.
 *
 * MetaTrader writes its exports as UTF-16LE (both the HTML report and the XML
 * parts inside an .xlsx), usually with a BOM and — in the .xlsx case — without
 * declaring `encoding=` in the XML prolog. `File.text()` and a plain UTF-8
 * decode turn those into interleaved-NUL garbage, which is why an otherwise
 * valid report can look like "not a report" to a naive parser.
 *
 * Order: BOM wins; otherwise sniff for the every-other-byte NUL pattern that
 * BOM-less UTF-16 always produces for Latin-heavy content; else UTF-8.
 */
export function decodeReportText(bytes: Uint8Array): string {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  }
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xef &&
    bytes[1] === 0xbb &&
    bytes[2] === 0xbf
  ) {
    return new TextDecoder("utf-8").decode(bytes.subarray(3));
  }

  const probe = bytes.subarray(0, 512);
  let nulAtEven = 0;
  let nulAtOdd = 0;
  for (let i = 0; i < probe.length; i += 1) {
    if (probe[i] === 0) {
      if (i % 2 === 0) nulAtEven += 1;
      else nulAtOdd += 1;
    }
  }
  // ASCII text as UTF-16LE puts a NUL in every odd byte (and vice versa for BE).
  const threshold = probe.length / 4;
  if (nulAtOdd > threshold && nulAtOdd > nulAtEven) {
    return new TextDecoder("utf-16le").decode(bytes);
  }
  if (nulAtEven > threshold && nulAtEven > nulAtOdd) {
    return new TextDecoder("utf-16be").decode(bytes);
  }
  return new TextDecoder("utf-8").decode(bytes);
}

/** Magic-byte file sniffing — filenames lie (some platforms emit HTML as .xls). */
export type ReportFileKind = "pdf" | "zip" | "ole2" | "text";

export function sniffFileKind(bytes: Uint8Array): ReportFileKind {
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46
  ) {
    return "pdf"; // %PDF
  }
  // PK\x03\x04 (also \x05\x06 empty archive, \x07\x08 spanned) → OOXML .xlsx
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const b2 = bytes[2];
    const b3 = bytes[3];
    if (
      (b2 === 0x03 && b3 === 0x04) ||
      (b2 === 0x05 && b3 === 0x06) ||
      (b2 === 0x07 && b3 === 0x08)
    ) {
      return "zip";
    }
  }
  // OLE2 compound file → legacy .xls / .doc
  if (
    bytes.length >= 8 &&
    bytes[0] === 0xd0 &&
    bytes[1] === 0xcf &&
    bytes[2] === 0x11 &&
    bytes[3] === 0xe0 &&
    bytes[4] === 0xa1 &&
    bytes[5] === 0xb1 &&
    bytes[6] === 0x1a &&
    bytes[7] === 0xe1
  ) {
    return "ole2";
  }
  return "text";
}
