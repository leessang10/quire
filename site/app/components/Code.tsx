import CopyButton from './CopyButton';

/** 코드 블록: 파일 이름(있으면)과 복사 단추 */
export default function Code({ children, file, lang }: { children: string; file?: string; lang?: string }) {
  const code = children.replace(/^\n/, '').replace(/\s+$/, '');
  return (
    <figure className="code">
      <figcaption>
        <span>{file ?? lang ?? ''}</span>
        <CopyButton text={code} />
      </figcaption>
      <pre>
        <code>{code}</code>
      </pre>
    </figure>
  );
}
