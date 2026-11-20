/**
 * PDF 파일 쓰기 (PDF 1.7): 간접 개체, 스트림(압축), 상호 참조 표, 트레일러. 외부 라이브러리 없이, DOM 없이.
 * 개체는 번호를 먼저 받고(ref) 나중에 쓸 수 있다 (쪽 트리처럼 앞뒤로 가리키는 개체).
 */

/** 간접 참조 */
export class Ref {
  constructor(readonly n: number) {}
}

/** 이름 (/Name) */
export class Name {
  constructor(readonly v: string) {}
}

/** 그대로 쓰는 조각 (연산자, 16진수 문자열 등) */
export class Raw {
  constructor(readonly v: string) {}
}

/** PDF 값 */
export type PdfValue = number | boolean | null | string | Ref | Name | Raw | PdfValue[] | { [k: string]: PdfValue | undefined };

export const name = (v: string) => new Name(v);
export const raw = (v: string) => new Raw(v);

/** 수: 소수 넷째 자리까지, 끝의 0을 뺀다 */
export function num(v: number): string {
  if (Number.isInteger(v)) return String(v);
  const s = v.toFixed(4);
  return s.replace(/\.?0+$/, '') || '0';
}

/** 글자열 (UTF-16BE BOM, 16진수): 책갈피 제목, 문서 정보 */
export function textString(s: string): Raw {
  let h = 'FEFF';
  for (let i = 0; i < s.length; i++) h += s.charCodeAt(i).toString(16).padStart(4, '0');
  return raw(`<${h}>`);
}

/** 이름 글자: 구분자·공백·# 은 #xx */
function nameToken(v: string): string {
  let out = '/';
  for (const ch of v) {
    const c = ch.charCodeAt(0);
    if (c < 0x21 || c > 0x7e || '()<>[]{}/%#'.includes(ch)) out += `#${c.toString(16).padStart(2, '0')}`;
    else out += ch;
  }
  return out;
}

/** 리터럴 글자열 (ASCII만, 괄호·역슬래시 탈출) */
function literal(s: string): string {
  return `(${s.replace(/[\\()]/g, (m) => `\\${m}`)})`;
}

export function serialize(v: PdfValue | undefined): string {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number') return num(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'string') return literal(v);
  if (v instanceof Ref) return `${v.n} 0 R`;
  if (v instanceof Name) return nameToken(v.v);
  if (v instanceof Raw) return v.v;
  if (Array.isArray(v)) return `[${v.map(serialize).join(' ')}]`;
  const parts: string[] = [];
  for (const [k, x] of Object.entries(v)) if (x !== undefined) parts.push(`${nameToken(k)} ${serialize(x)}`);
  return `<<${parts.join(' ')}>>`;
}

/** 압축 (zlib deflate): 브라우저·Node 18+의 CompressionStream */
export type Deflate = (data: Uint8Array) => Promise<Uint8Array>;

export const streamDeflate: Deflate = async (data) => {
  const cs = new CompressionStream('deflate');
  const out = new Blob([data as BlobPart]).stream().pipeThrough(cs);
  return new Uint8Array(await new Response(out).arrayBuffer());
};

export const streamInflate = async (data: Uint8Array): Promise<Uint8Array> => {
  const ds = new DecompressionStream('deflate');
  const out = new Blob([data as BlobPart]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(out).arrayBuffer());
};

const enc = new TextEncoder();

/** 글자를 바이트로 (PDF 문법은 ASCII. 내용 스트림의 글자는 16진수라 ASCII뿐이다) */
export function latin1(s: string): Uint8Array {
  return enc.encode(s);
}

export class PdfWriter {
  private readonly chunks: Uint8Array[] = [];
  private length = 0;
  private readonly offsets: number[] = [0];
  private next = 1;

  constructor(private readonly deflate: Deflate = streamDeflate) {
    // 머리말과 이진 표시 (전송 도구가 이진 파일로 다루게)
    this.push(latin1('%PDF-1.7\n'));
    this.push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
  }

  private push(b: Uint8Array): void {
    this.chunks.push(b);
    this.length += b.length;
  }

  /** 개체 번호를 받는다 (나중에 write로 쓴다) */
  ref(): Ref {
    return new Ref(this.next++);
  }

  /** 개체를 쓴다 (번호가 없으면 새로) */
  write(value: PdfValue, ref: Ref = this.ref()): Ref {
    this.offsets[ref.n] = this.length;
    this.push(latin1(`${ref.n} 0 obj\n${serialize(value)}\nendobj\n`));
    return ref;
  }

  /** 스트림 개체. compress면 FlateDecode로 압축한다 (이미 압축한 데이터는 dict에 Filter를 넣고 false) */
  async stream(dict: { [k: string]: PdfValue | undefined }, data: Uint8Array, compress = true, ref: Ref = this.ref()): Promise<Ref> {
    let body = data;
    const d = { ...dict };
    if (compress) {
      body = await this.deflate(data);
      d.Filter = name('FlateDecode');
    }
    d.Length = body.length;
    this.offsets[ref.n] = this.length;
    this.push(latin1(`${ref.n} 0 obj\n${serialize(d)}\nstream\n`));
    this.push(body);
    this.push(latin1('\nendstream\nendobj\n'));
    return ref;
  }

  /** 상호 참조 표와 트레일러를 쓰고 파일을 낸다 */
  finish(root: Ref, info?: Ref): Uint8Array {
    const xref = this.length;
    const n = this.next;
    let s = `xref\n0 ${n}\n0000000000 65535 f \n`;
    for (let i = 1; i < n; i++) {
      const o = this.offsets[i];
      s += o === undefined ? '0000000000 65535 f \n' : `${String(o).padStart(10, '0')} 00000 n \n`;
    }
    s += `trailer\n${serialize({ Size: n, Root: root, Info: info })}\nstartxref\n${xref}\n%%EOF\n`;
    this.push(latin1(s));
    const out = new Uint8Array(this.length);
    let at = 0;
    for (const c of this.chunks) {
      out.set(c, at);
      at += c.length;
    }
    return out;
  }
}
