/**
 * 创意文档解析（SRS-105 REQ-PRJ-035）：把用户上传的文档抽成纯文本，供 AI 解析创意。
 *
 * 支持：txt/md/markdown/csv/tsv/json/yml/yaml/log（按 UTF-8 直读）；
 *       docx/xlsx（OOXML 包，Node 内置 zlib 解压，不引第三方依赖）；
 *       pdf（轻量文本层提取：FlateDecode 流 + Tj/TJ 文本算子，扫描件/嵌字体可能提取失败）。
 * 边界：只解析文本，不执行文档宏/脚本；单文件与总量限流；失败给明确错误码，不静默返回空。
 */
import { inflateRawSync } from "node:zlib";
import { OpcError, ERR } from "../platform/errors.ts";

export interface IdeaDocumentInput {
  name: string;
  contentBase64: string;
}

export interface ExtractedDocument {
  name: string;
  kind: string;
  bytes: number;
  chars: number;
  text: string;
  warnings: string[];
}

const MAX_FILES = 10;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
const TEXT_EXT = new Set(["txt", "md", "markdown", "csv", "tsv", "json", "yml", "yaml", "log", "html", "htm", "xml"]);
const SUPPORTED = new Set([...TEXT_EXT, "docx", "xlsx", "pdf"]);

function extensionOf(name: string): string {
  const match = /\.([A-Za-z0-9]+)$/.exec(name.trim());
  return match === null ? "" : match[1].toLowerCase();
}

function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function stripXml(xml: string): string {
  return decodeEntities(xml.replace(/<[^>]+>/g, "")).replace(/\r/g, "");
}

// ---------------------------------------------------------------- ZIP（OOXML）

interface ZipEntry {
  name: string;
  method: number;
  compressed: Buffer;
}

export function readZipEntries(buffer: Buffer): ZipEntry[] {
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65_558); i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("不是有效的 ZIP/OOXML 文件");
  const count = buffer.readUInt16LE(eocd + 10);
  let pointer = buffer.readUInt32LE(eocd + 16);
  const entries: ZipEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(pointer) !== 0x02014b50) break;
    const method = buffer.readUInt16LE(pointer + 10);
    const compressedSize = buffer.readUInt32LE(pointer + 20);
    const nameLength = buffer.readUInt16LE(pointer + 28);
    const extraLength = buffer.readUInt16LE(pointer + 30);
    const commentLength = buffer.readUInt16LE(pointer + 32);
    const localOffset = buffer.readUInt32LE(pointer + 42);
    const name = buffer.slice(pointer + 46, pointer + 46 + nameLength).toString("utf8");
    if (buffer.readUInt32LE(localOffset) === 0x04034b50) {
      const localNameLength = buffer.readUInt16LE(localOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localOffset + 28);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      entries.push({ name, method, compressed: buffer.slice(dataStart, dataStart + compressedSize) });
    }
    pointer += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function zipText(entry: ZipEntry): string {
  const raw = entry.method === 0 ? entry.compressed : inflateRawSync(entry.compressed);
  return raw.toString("utf8");
}

function extractDocx(buffer: Buffer): string {
  const entries = readZipEntries(buffer);
  const doc = entries.find((entry) => entry.name === "word/document.xml");
  if (doc === undefined) throw new Error("docx 缺少 word/document.xml");
  const xml = zipText(doc)
    .replace(/<w:tab\/>/g, "\t")
    .replace(/<w:br\/>/g, "\n")
    .replace(/<\/w:p>/g, "\n");
  return stripXml(xml)
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractXlsx(buffer: Buffer): string {
  const entries = readZipEntries(buffer);
  const sharedEntry = entries.find((entry) => entry.name === "xl/sharedStrings.xml");
  const shared: string[] = [];
  if (sharedEntry !== undefined) {
    const xml = zipText(sharedEntry);
    for (const match of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      shared.push(stripXml(match[1]).trim());
    }
  }
  const sheets = entries
    .filter((entry) => /^xl\/worksheets\/sheet\d+\.xml$/.test(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 3);
  if (sheets.length === 0) throw new Error("xlsx 缺少工作表");
  const lines: string[] = [];
  for (const sheet of sheets) {
    const xml = zipText(sheet);
    for (const row of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells: string[] = [];
      for (const cell of row[1].matchAll(/<c\b[^>]*?(?:t="([^"]*)")?[^>]*>([\s\S]*?)<\/c>/g)) {
        const type = cell[1] ?? "";
        const body = cell[2];
        const value = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
        const inline = /<is>([\s\S]*?)<\/is>/.exec(body)?.[1];
        if (type === "s" && value !== undefined) cells.push(shared[Number(value)] ?? "");
        else if (inline !== undefined) cells.push(stripXml(inline).trim());
        else cells.push(value === undefined ? "" : decodeEntities(value).trim());
      }
      if (cells.some((value) => value !== "")) lines.push(cells.join("\t"));
    }
  }
  return lines.join("\n").trim();
}

// ---------------------------------------------------------------- PDF（轻量）

function pdfUnescape(text: string): string {
  return text.replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_match, code: string) => {
    switch (code) {
      case "n": return "\n";
      case "r": return "\r";
      case "t": return "\t";
      case "b": return "\b";
      case "f": return "\f";
      case "(": return "(";
      case ")": return ")";
      case "\\": return "\\";
      default: return String.fromCharCode(Number.parseInt(code, 8));
    }
  });
}

function extractPdf(buffer: Buffer): string {
  const latin = buffer.toString("latin1");
  const chunks: string[] = [];
  const streamPattern = /stream\r?\n/g;
  let match: RegExpExecArray | null;
  while ((match = streamPattern.exec(latin)) !== null) {
    const start = match.index + match[0].length;
    const end = latin.indexOf("endstream", start);
    if (end < 0) break;
    const raw = buffer.slice(start, end);
    let content = "";
    try {
      content = inflateRawSync(raw).toString("latin1");
    } catch {
      content = raw.toString("latin1");
    }
    if (!/(Tj|TJ)\b/.test(content)) {
      streamPattern.lastIndex = end;
      continue;
    }
    const tokens = content.matchAll(/(\((?:\\\\.|[^\\\\)])*\)|<[0-9A-Fa-f\s]+>)\s*(Tj|TJ|'|")|(Td|TD|T\*|ET)\b/g);
    for (const token of tokens) {
      if (token[0] === undefined) continue;
      if (token[3] !== undefined) {
        chunks.push("\n");
        continue;
      }
      const literal = token[1];
      if (literal.startsWith("(")) chunks.push(pdfUnescape(literal.slice(1, -1)));
      else if (literal.startsWith("<")) {
        const hex = literal.slice(1, -1).replace(/\s+/g, "");
        let ascii = "";
        for (let index = 0; index + 1 < hex.length; index += 2) {
          const code = Number.parseInt(hex.slice(index, index + 2), 16);
          if (code >= 32 && code < 127) ascii += String.fromCharCode(code);
        }
        chunks.push(ascii);
      }
    }
    streamPattern.lastIndex = end;
  }
  const text = chunks.join("").replace(/\n{3,}/g, "\n\n").trim();
  if (text.length < 20) throw new Error("PDF 文本层提取失败（可能是扫描件或嵌入 CID 字体），请转成 txt/md 后重试");
  return text;
}

// ---------------------------------------------------------------- 入口

export function extractDocuments(files: IdeaDocumentInput[] | undefined): ExtractedDocument[] {
  if (files === undefined || files === null) return [];
  if (!Array.isArray(files)) throw new OpcError(ERR.IDEA_INVALID, "files 必须是数组", 400);
  if (files.length > MAX_FILES) throw new OpcError(ERR.IDEA_INVALID, `一次最多上传 ${MAX_FILES} 个文档`, 400);
  const results: ExtractedDocument[] = [];
  let total = 0;
  for (const file of files) {
    const name = typeof file?.name === "string" ? file.name.trim() : "";
    if (name === "") throw new OpcError(ERR.IDEA_INVALID, "文档缺少文件名", 400);
    const ext = extensionOf(name);
    if (!SUPPORTED.has(ext)) {
      throw new OpcError(ERR.IDEA_DOC, `不支持的文档格式：${ext || "(无扩展名)"}；支持 ${[...SUPPORTED].join("/")}`, 415);
    }
    const base64 = typeof file.contentBase64 === "string" ? file.contentBase64.replace(/^data:[^;]+;base64,/, "") : "";
    if (base64 === "") throw new OpcError(ERR.IDEA_INVALID, `文档 ${name} 内容为空`, 400);
    const buffer = Buffer.from(base64, "base64");
    if (buffer.length === 0) throw new OpcError(ERR.IDEA_INVALID, `文档 ${name} 解码失败`, 400);
    if (buffer.length > MAX_FILE_BYTES) throw new OpcError(ERR.IDEA_DOC, `文档 ${name} 超过 10MB`, 413);
    total += buffer.length;
    if (total > MAX_TOTAL_BYTES) throw new OpcError(ERR.IDEA_DOC, "文档总大小超过 20MB", 413);

    const warnings: string[] = [];
    let text = "";
    try {
      if (TEXT_EXT.has(ext)) {
        text = buffer.toString("utf8");
        if (text.includes("\u0000")) {
          warnings.push("检测到二进制内容，已按文本处理");
          text = text.replace(/\u0000/g, "");
        }
      } else if (ext === "docx") {
        text = extractDocx(buffer);
      } else if (ext === "xlsx") {
        text = extractXlsx(buffer);
      } else {
        text = extractPdf(buffer);
      }
    } catch (error) {
      if (error instanceof OpcError) throw error;
      const detail = error instanceof Error ? error.message : String(error);
      throw new OpcError(ERR.IDEA_DOC, `文档 ${name} 解析失败：${detail}`, 422);
    }
    text = text.trim();
    if (text === "") throw new OpcError(ERR.IDEA_DOC, `文档 ${name} 未解析出文本`, 422);
    results.push({ name, kind: ext, bytes: buffer.length, chars: text.length, text: text.slice(0, 40_000), warnings });
  }
  return results;
}
