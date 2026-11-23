/** 메뉴 막대: 파일·수정·보기·삽입·서식·표·도구·도움말. 도구 막대에 없는 기능까지 모두 여기서 닿는다 */
import {
  BookOpen,
  Columns2,
  Download,
  FilePlus,
  FileText,
  FolderOpen,
  Footprints,
  Highlighter,
  ImagePlus,
  Link2,
  MessageSquarePlus,
  PanelTop,
  Printer,
  Redo2,
  Search,
  SeparatorHorizontal,
  Sparkles,
  Table,
  Undo2,
} from 'lucide-react';
import type { Editor } from '@quire/editor';
import { SAMPLES, SAVE_FORMATS, zoomPercent, zoomStep, type SaveFormat, type Ui } from '../lib/quire-app';
import { BarMenu, MenuBar, MenuItem, MenuLabel, MenuSeparator, SubMenu } from './ui';

type Act = (f: (e: Editor) => unknown) => void;

export interface MenuActions {
  newDoc: () => void;
  tour: () => void;
  sample: (id: string) => void;
  open: () => void;
  save: (kind: SaveFormat) => void;
  print: () => void;
  find: (replace: boolean) => void;
  link: () => void;
  image: () => void;
  comment: () => void;
  pageSetup: () => void;
  wordCount: () => void;
  shortcuts: () => void;
  about: () => void;
  togglePanel: (p: 'outline' | 'review') => void;
  toggleSpell: () => void;
}

export function AppMenus({ ui, act, a, panels }: { ui: Ui | null; act: Act; a: MenuActions; panels: { outline: boolean; review: boolean } }) {
  const p = ui?.para;
  const t = ui?.table;
  return (
    <MenuBar>
      <BarMenu label="파일">
        <MenuItem icon={<FilePlus className="size-4" />} onSelect={a.newDoc}>
          새 문서
        </MenuItem>
        <MenuItem icon={<FolderOpen className="size-4" />} shortcut="Ctrl+O" onSelect={a.open}>
          열기… <span className="text-xs text-slate-400">(.quire .hwpx .docx .md .html)</span>
        </MenuItem>
        <SubMenu label="예제 문서" icon={<BookOpen className="size-4" />}>
          <MenuItem icon={<Sparkles className="size-4" />} onSelect={a.tour}>
            기능 둘러보기
          </MenuItem>
          <MenuSeparator />
          {SAMPLES.map((s) => (
            <MenuItem key={s.id} icon={<FileText className="size-4" />} onSelect={() => a.sample(s.id)}>
              {s.label} <span className="text-xs text-slate-400">· {s.about}</span>
            </MenuItem>
          ))}
        </SubMenu>
        <MenuSeparator />
        <SubMenu label="내려받기" icon={<Download className="size-4" />}>
          {SAVE_FORMATS.map((f) => (
            <MenuItem key={f.kind} onSelect={() => a.save(f.kind)} shortcut={f.kind === 'quire' ? 'Ctrl+S' : undefined}>
              {f.label} <span className="text-xs text-slate-400">{f.ext}</span>
            </MenuItem>
          ))}
        </SubMenu>
        <MenuItem icon={<PanelTop className="size-4" />} onSelect={a.pageSetup}>
          쪽 설정…
        </MenuItem>
        <MenuItem icon={<Printer className="size-4" />} shortcut="Ctrl+P" onSelect={a.print}>
          인쇄 (PDF)
        </MenuItem>
      </BarMenu>

      <BarMenu label="수정">
        <MenuItem icon={<Undo2 className="size-4" />} shortcut="Ctrl+Z" disabled={!ui?.canUndo} onSelect={() => act((e) => e.undo())}>
          실행 취소
        </MenuItem>
        <MenuItem icon={<Redo2 className="size-4" />} shortcut="Ctrl+Y" disabled={!ui?.canRedo} onSelect={() => act((e) => e.redo())}>
          다시 실행
        </MenuItem>
        <MenuSeparator />
        <MenuItem icon={<Search className="size-4" />} shortcut="Ctrl+F" onSelect={() => a.find(false)}>
          찾기
        </MenuItem>
        <MenuItem shortcut="Ctrl+H" onSelect={() => a.find(true)}>
          찾아 바꾸기
        </MenuItem>
      </BarMenu>

      <BarMenu label="보기">
        <MenuItem checked={panels.outline} onSelect={() => a.togglePanel('outline')}>
          개요
        </MenuItem>
        <MenuItem checked={panels.review} onSelect={() => a.togglePanel('review')}>
          댓글·제안
        </MenuItem>
        <MenuItem checked={!!ui?.formatMarks} onSelect={() => act((e) => e.setShowMarks(!ui?.formatMarks))}>
          편집 기호 표시
        </MenuItem>
        <MenuSeparator />
        <MenuLabel>확대/축소 ({zoomPercent(ui?.zoom ?? 1)})</MenuLabel>
        <MenuItem onSelect={() => act((e) => e.setZoom(zoomStep(e.zoom, 1)))}>확대</MenuItem>
        <MenuItem onSelect={() => act((e) => e.setZoom(zoomStep(e.zoom, -1)))}>축소</MenuItem>
        <MenuItem onSelect={() => act((e) => e.setZoom(1))}>100%</MenuItem>
        <MenuItem onSelect={() => act((e) => e.setZoom(e.fitWidthZoom()))}>쪽 폭에 맞춤</MenuItem>
        <MenuSeparator />
        <MenuLabel>문서 보기</MenuLabel>
        <MenuItem checked={ui?.viewMode === 'suggestions'} onSelect={() => act((e) => e.setViewMode('suggestions'))}>
          제안 표시
        </MenuItem>
        <MenuItem checked={ui?.viewMode === 'final'} onSelect={() => act((e) => e.setViewMode('final'))}>
          최종본
        </MenuItem>
        <MenuItem checked={ui?.viewMode === 'original'} onSelect={() => act((e) => e.setViewMode('original'))}>
          원본
        </MenuItem>
        <MenuSeparator />
        <MenuLabel>편집기 언어</MenuLabel>
        <MenuItem checked={ui?.locale === 'ko'} onSelect={() => act((e) => e.setLocale('ko'))}>
          한국어
        </MenuItem>
        <MenuItem checked={ui?.locale === 'en'} onSelect={() => act((e) => e.setLocale('en'))}>
          English
        </MenuItem>
      </BarMenu>

      <BarMenu label="삽입">
        <MenuItem icon={<ImagePlus className="size-4" />} onSelect={a.image}>
          그림…
        </MenuItem>
        <MenuItem icon={<Table className="size-4" />} onSelect={() => act((e) => e.insertTable(3, 3))}>
          표 (3×3)
        </MenuItem>
        <MenuItem icon={<Link2 className="size-4" />} onSelect={a.link}>
          링크…
        </MenuItem>
        <MenuItem icon={<MessageSquarePlus className="size-4" />} shortcut="Ctrl+Alt+M" onSelect={a.comment}>
          댓글
        </MenuItem>
        <MenuItem icon={<Footprints className="size-4" />} onSelect={() => act((e) => e.insertFootnote())}>
          각주
        </MenuItem>
        <MenuSeparator />
        <SubMenu label="나누기" icon={<SeparatorHorizontal className="size-4" />}>
          <MenuItem shortcut="Ctrl+Enter" onSelect={() => act((e) => e.insertPageBreak())}>
            쪽 나누기
          </MenuItem>
          <MenuItem shortcut="Ctrl+Shift+Enter" onSelect={() => act((e) => e.insertColumnBreak())}>
            단 나누기
          </MenuItem>
          <MenuItem shortcut="Ctrl+Alt+Enter" onSelect={() => act((e) => e.insertSectionBreak('nextPage'))}>
            구역 나누기 (다음 쪽)
          </MenuItem>
          <MenuItem onSelect={() => act((e) => e.insertSectionBreak('continuous'))}>구역 나누기 (이어서)</MenuItem>
        </SubMenu>
        <SubMenu label="머리말·꼬리말">
          <MenuItem onSelect={() => act((e) => e.editHeaderFooter('header'))}>머리말 고치기</MenuItem>
          <MenuItem onSelect={() => act((e) => e.editHeaderFooter('footer'))}>꼬리말 고치기</MenuItem>
        </SubMenu>
        <SubMenu label="쪽 번호" icon={<FileText className="size-4" />}>
          <MenuItem onSelect={() => act((e) => e.insertField('page'))}>지금 쪽 번호</MenuItem>
          <MenuItem onSelect={() => act((e) => e.insertField('pages'))}>전체 쪽 수</MenuItem>
        </SubMenu>
      </BarMenu>

      <BarMenu label="서식">
        <SubMenu label="글자">
          <MenuItem checked={!!ui?.marks.bold} shortcut="Ctrl+B" onSelect={() => act((e) => e.toggleMark('bold'))}>
            굵게
          </MenuItem>
          <MenuItem checked={!!ui?.marks.italic} shortcut="Ctrl+I" onSelect={() => act((e) => e.toggleMark('italic'))}>
            기울임
          </MenuItem>
          <MenuItem checked={!!ui?.marks.underline} shortcut="Ctrl+U" onSelect={() => act((e) => e.toggleMark('underline'))}>
            밑줄
          </MenuItem>
          <MenuItem checked={!!ui?.marks.strike} onSelect={() => act((e) => e.toggleMark('strike'))}>
            취소선
          </MenuItem>
          <MenuItem checked={ui?.marks.script === 'sup'} onSelect={() => act((e) => e.toggleScript('sup'))}>
            위 첨자
          </MenuItem>
          <MenuItem checked={ui?.marks.script === 'sub'} onSelect={() => act((e) => e.toggleScript('sub'))}>
            아래 첨자
          </MenuItem>
          <MenuSeparator />
          <MenuItem onSelect={() => act((e) => e.clearMarks())}>서식 지우기</MenuItem>
        </SubMenu>
        <SubMenu label="쪽 나눔 제어">
          <MenuItem checked={!!p?.pageBreakBefore} onSelect={() => act((e) => e.toggleParagraphKeep('pageBreakBefore'))}>
            문단 앞에서 쪽 나누기
          </MenuItem>
          <MenuItem checked={!!p?.keepWithNext} onSelect={() => act((e) => e.toggleParagraphKeep('keepWithNext'))}>
            다음 문단과 같은 쪽에
          </MenuItem>
          <MenuItem checked={!!p?.keepTogether} onSelect={() => act((e) => e.toggleParagraphKeep('keepTogether'))}>
            문단을 나누지 않기
          </MenuItem>
        </SubMenu>
        <SubMenu label="한글 조판">
          <MenuItem checked={p?.koreanBreak === 'word'} onSelect={() => act((e) => e.setParagraphAttr('koreanBreak', undefined))}>
            어절 단위로 줄 바꾸기
          </MenuItem>
          <MenuItem checked={p?.koreanBreak === 'char'} onSelect={() => act((e) => e.setParagraphAttr('koreanBreak', 'char'))}>
            글자 단위로 줄 바꾸기
          </MenuItem>
          <MenuSeparator />
          <MenuItem checked={!!p?.hangPunct} onSelect={() => act((e) => e.setParagraphAttr('hangPunct', p?.hangPunct ? undefined : true))}>
            문장부호 내어 쓰기
          </MenuItem>
          <MenuItem checked={!!p?.squeeze} onSelect={() => act((e) => e.setParagraphAttr('squeeze', p?.squeeze ? undefined : true))}>
            줄 끝 공백 줄이기
          </MenuItem>
        </SubMenu>
        <MenuSeparator />
        <MenuItem icon={<Columns2 className="size-4" />} onSelect={a.pageSetup}>
          쪽 설정·다단…
        </MenuItem>
      </BarMenu>

      <BarMenu label="표">
        <MenuItem onSelect={() => act((e) => e.insertTable(3, 3))}>표 넣기 (3×3)</MenuItem>
        <MenuSeparator />
        <MenuItem disabled={!t?.inTable} onSelect={() => act((e) => e.tableAddRow(false))}>
          위에 행 넣기
        </MenuItem>
        <MenuItem disabled={!t?.inTable} onSelect={() => act((e) => e.tableAddRow(true))}>
          아래에 행 넣기
        </MenuItem>
        <MenuItem disabled={!t?.inTable} onSelect={() => act((e) => e.tableAddCol(false))}>
          왼쪽에 열 넣기
        </MenuItem>
        <MenuItem disabled={!t?.inTable} onSelect={() => act((e) => e.tableAddCol(true))}>
          오른쪽에 열 넣기
        </MenuItem>
        <MenuSeparator />
        <MenuItem disabled={!t?.inTable} onSelect={() => act((e) => e.tableDelete('row'))}>
          행 지우기
        </MenuItem>
        <MenuItem disabled={!t?.inTable} onSelect={() => act((e) => e.tableDelete('col'))}>
          열 지우기
        </MenuItem>
        <MenuItem disabled={!t?.inTable} onSelect={() => act((e) => e.deleteTable())}>
          표 지우기
        </MenuItem>
        <MenuSeparator />
        <MenuItem disabled={!t?.range} onSelect={() => act((e) => e.tableMerge())}>
          셀 합치기
        </MenuItem>
        <MenuItem disabled={!t?.merged} onSelect={() => act((e) => e.tableUnmerge())}>
          셀 나누기
        </MenuItem>
        <MenuSeparator />
        <MenuItem disabled={!t?.inTable} checked={!!t?.header} onSelect={() => act((e) => e.tableSetRowFlag('header', !t?.header))}>
          제목 행 (쪽마다 반복)
        </MenuItem>
        <MenuItem disabled={!t?.inTable} checked={!!t?.cantSplit} onSelect={() => act((e) => e.tableSetRowFlag('cantSplit', !t?.cantSplit))}>
          행을 쪽에서 나누지 않기
        </MenuItem>
      </BarMenu>

      <BarMenu label="도구">
        <MenuItem checked={!!ui?.spell} onSelect={a.toggleSpell}>
          맞춤법 검사 <span className="text-xs text-slate-400">(데모 검사기)</span>
        </MenuItem>
        <MenuItem onSelect={a.wordCount}>글자 수 세기</MenuItem>
        <MenuSeparator />
        <MenuItem checked={!!ui?.suggesting} onSelect={() => act((e) => e.setSuggesting(!ui?.suggesting))}>
          제안 모드
        </MenuItem>
        <MenuItem disabled={!ui?.suggestions} onSelect={() => act((e) => e.acceptAll())}>
          제안 모두 수락
        </MenuItem>
        <MenuItem disabled={!ui?.suggestions} onSelect={() => act((e) => e.rejectAll())}>
          제안 모두 거부
        </MenuItem>
        <MenuSeparator />
        <MenuItem icon={<Highlighter className="size-4" />} shortcut="Ctrl+Alt+K" disabled={!ui?.hasSelection} onSelect={() => act((e) => e.run('highlightWords.addSelection'))}>
          강조 낱말로 더하기 <span className="text-xs text-slate-400">(플러그인)</span>
        </MenuItem>
        <MenuItem shortcut="Ctrl+Alt+J" onSelect={() => act((e) => e.run('highlightWords.next'))}>
          다음 강조 낱말로
        </MenuItem>
      </BarMenu>

      <BarMenu label="도움말">
        <MenuItem onSelect={a.shortcuts}>단축키</MenuItem>
        <MenuItem onSelect={a.about}>이 예제에 대해</MenuItem>
      </BarMenu>
    </MenuBar>
  );
}
