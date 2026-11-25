import CopyButton from './CopyButton';
import { UI, type Lang } from '../../lib/i18n';

/** 코드 블록: 파일 이름(있으면)과 복사 단추. ui = 단추 언어 */
export default function Code({ children, file, lang, ui = 'ko' }: { children: string; file?: string; lang?: string; ui?: Lang }) {
  const code = children.replace(/^\n/, '').replace(/\s+$/, '');
  const t = UI[ui];
  return (
    <figure className="code">
      <figcaption>
        <span>{file ?? lang ?? ''}</span>
        <CopyButton text={code} label={file ?? (lang === 'sh' ? t.command : t.code)} ui={ui} />
      </figcaption>
      <pre>
        <code>{code}</code>
      </pre>
    </figure>
  );
}
