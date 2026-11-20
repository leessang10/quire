'use client';
/** 메뉴 막대 (shadcn Menubar): 파일·수정·보기·삽입·서식·표·도구·도움말 */
import type { ReactNode } from 'react';
import { BookOpen, Columns2, Download, FilePlus, FileText, FolderOpen, Footprints, ImagePlus, Link2, MessageSquarePlus, PanelTop, Printer, Redo2, Search, SeparatorHorizontal, Sparkles, Table, Undo2 } from 'lucide-react';
import {
  Menubar,
  MenubarCheckboxItem,
  MenubarContent,
  MenubarGroup,
  MenubarItem,
  MenubarLabel,
  MenubarMenu,
  MenubarRadioGroup,
  MenubarRadioItem,
  MenubarSeparator,
  MenubarShortcut,
  MenubarSub,
  MenubarSubContent,
  MenubarSubTrigger,
  MenubarTrigger,
} from '@/components/ui/menubar';
import type { Act } from '@/lib/use-ui';
import { SAMPLES, SAVE_FORMATS, type SaveFormat, type Ui } from '@/lib/quire-app';

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

/** 메뉴 하나 (닫혀도 포커스를 메뉴 단추로 돌리지 않는다: 편집기로 돌아간다) */
function Menu({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <MenubarMenu>
      <MenubarTrigger>{label}</MenubarTrigger>
      <MenubarContent finalFocus={false} className={wide ? 'w-72' : 'w-60'}>
        {children}
      </MenubarContent>
    </MenubarMenu>
  );
}

function Item({ onSelect, children, shortcut, disabled, icon }: { onSelect: () => void; children: ReactNode; shortcut?: string; disabled?: boolean; icon?: ReactNode }) {
  return (
    <MenubarItem onClick={onSelect} disabled={disabled}>
      {icon}
      <span className={icon ? '' : 'pl-5.5'}>{children}</span>
      {shortcut && <MenubarShortcut>{shortcut}</MenubarShortcut>}
    </MenubarItem>
  );
}

function Check({ checked, onSelect, children, shortcut, disabled }: { checked: boolean; onSelect: () => void; children: ReactNode; shortcut?: string; disabled?: boolean }) {
  return (
    <MenubarCheckboxItem checked={checked} onCheckedChange={() => onSelect()} disabled={disabled}>
      {children}
      {shortcut && <MenubarShortcut>{shortcut}</MenubarShortcut>}
    </MenubarCheckboxItem>
  );
}

const Hint = ({ children }: { children: ReactNode }) => <span className="text-xs text-muted-foreground">{children}</span>;

export function AppMenubar({ ui, act, a, panels }: { ui: Ui | null; act: Act; a: MenuActions; panels: { outline: boolean; review: boolean } }) {
  const p = ui?.para;
  const t = ui?.table;
  const icon = 'size-4 text-muted-foreground';
  return (
    <Menubar className="h-7 border-0 bg-transparent p-0 shadow-none">
      <Menu label="파일" wide>
        <MenubarGroup>
          <Item icon={<FilePlus className={icon} />} onSelect={a.newDoc}>
            새 문서
          </Item>
          <Item icon={<FolderOpen className={icon} />} shortcut="Ctrl+O" onSelect={a.open}>
            열기…
          </Item>
          <MenubarSub>
            <MenubarSubTrigger>
              <BookOpen className={icon} />
              예제 문서
            </MenubarSubTrigger>
            <MenubarSubContent className="w-72">
              <Item icon={<Sparkles className={icon} />} onSelect={a.tour}>
                기능 둘러보기
              </Item>
              <MenubarSeparator />
              {SAMPLES.map((s) => (
                <Item key={s.id} icon={<FileText className={icon} />} onSelect={() => a.sample(s.id)}>
                  {s.label} <Hint>· {s.about}</Hint>
                </Item>
              ))}
            </MenubarSubContent>
          </MenubarSub>
        </MenubarGroup>
        <MenubarSeparator />
        <MenubarGroup>
          <MenubarSub>
            <MenubarSubTrigger>
              <Download className={icon} />
              내려받기
            </MenubarSubTrigger>
            <MenubarSubContent className="w-56">
              {SAVE_FORMATS.map((f) => (
                <Item key={f.kind} onSelect={() => a.save(f.kind)} shortcut={f.kind === 'quire' ? 'Ctrl+S' : undefined}>
                  {f.label} <Hint>{f.ext}</Hint>
                </Item>
              ))}
            </MenubarSubContent>
          </MenubarSub>
          <Item icon={<PanelTop className={icon} />} onSelect={a.pageSetup}>
            쪽 설정…
          </Item>
          <Item icon={<Printer className={icon} />} shortcut="Ctrl+P" onSelect={a.print}>
            인쇄 (PDF)
          </Item>
        </MenubarGroup>
      </Menu>

      <Menu label="수정">
        <MenubarGroup>
          <Item icon={<Undo2 className={icon} />} shortcut="Ctrl+Z" disabled={!ui?.canUndo} onSelect={() => act((e) => e.undo())}>
            실행 취소
          </Item>
          <Item icon={<Redo2 className={icon} />} shortcut="Ctrl+Y" disabled={!ui?.canRedo} onSelect={() => act((e) => e.redo())}>
            다시 실행
          </Item>
        </MenubarGroup>
        <MenubarSeparator />
        <MenubarGroup>
          <Item icon={<Search className={icon} />} shortcut="Ctrl+F" onSelect={() => a.find(false)}>
            찾기
          </Item>
          <Item shortcut="Ctrl+H" onSelect={() => a.find(true)}>
            찾아 바꾸기
          </Item>
        </MenubarGroup>
      </Menu>

      <Menu label="보기">
        <MenubarGroup>
          <Check checked={panels.outline} onSelect={() => a.togglePanel('outline')}>
            개요
          </Check>
          <Check checked={panels.review} onSelect={() => a.togglePanel('review')}>
            댓글·제안
          </Check>
        </MenubarGroup>
        <MenubarSeparator />
        <MenubarGroup>
          <MenubarLabel>문서 보기</MenubarLabel>
          <MenubarRadioGroup value={ui?.viewMode ?? 'suggestions'} onValueChange={(v) => act((e) => e.setViewMode(v as 'suggestions'))}>
            <MenubarRadioItem value="suggestions">제안 표시</MenubarRadioItem>
            <MenubarRadioItem value="final">최종본</MenubarRadioItem>
            <MenubarRadioItem value="original">원본</MenubarRadioItem>
          </MenubarRadioGroup>
        </MenubarGroup>
        <MenubarSeparator />
        <MenubarGroup>
          <MenubarLabel>편집기 언어</MenubarLabel>
          <MenubarRadioGroup value={ui?.locale ?? 'ko'} onValueChange={(v) => act((e) => e.setLocale(String(v)))}>
            <MenubarRadioItem value="ko">한국어</MenubarRadioItem>
            <MenubarRadioItem value="en">English</MenubarRadioItem>
          </MenubarRadioGroup>
        </MenubarGroup>
      </Menu>

      <Menu label="삽입">
        <MenubarGroup>
          <Item icon={<ImagePlus className={icon} />} onSelect={a.image}>
            그림…
          </Item>
          <Item icon={<Table className={icon} />} onSelect={() => act((e) => e.insertTable(3, 3))}>
            표 (3×3)
          </Item>
          <Item icon={<Link2 className={icon} />} onSelect={a.link}>
            링크…
          </Item>
          <Item icon={<MessageSquarePlus className={icon} />} shortcut="Ctrl+Alt+M" onSelect={a.comment}>
            댓글
          </Item>
          <Item icon={<Footprints className={icon} />} onSelect={() => act((e) => e.insertFootnote())}>
            각주
          </Item>
        </MenubarGroup>
        <MenubarSeparator />
        <MenubarGroup>
          <MenubarSub>
            <MenubarSubTrigger>
              <SeparatorHorizontal className={icon} />
              나누기
            </MenubarSubTrigger>
            <MenubarSubContent className="w-60">
              <Item shortcut="Ctrl+Enter" onSelect={() => act((e) => e.insertPageBreak())}>
                쪽 나누기
              </Item>
              <Item shortcut="Ctrl+Shift+Enter" onSelect={() => act((e) => e.insertColumnBreak())}>
                단 나누기
              </Item>
              <Item shortcut="Ctrl+Alt+Enter" onSelect={() => act((e) => e.insertSectionBreak('nextPage'))}>
                구역 나누기 (다음 쪽)
              </Item>
              <Item onSelect={() => act((e) => e.insertSectionBreak('continuous'))}>구역 나누기 (이어서)</Item>
            </MenubarSubContent>
          </MenubarSub>
          <MenubarSub>
            <MenubarSubTrigger>
              <PanelTop className={icon} />
              머리말·꼬리말
            </MenubarSubTrigger>
            <MenubarSubContent className="w-48">
              <Item onSelect={() => act((e) => e.editHeaderFooter('header'))}>머리말 고치기</Item>
              <Item onSelect={() => act((e) => e.editHeaderFooter('footer'))}>꼬리말 고치기</Item>
            </MenubarSubContent>
          </MenubarSub>
          <MenubarSub>
            <MenubarSubTrigger>
              <FileText className={icon} />
              쪽 번호
            </MenubarSubTrigger>
            <MenubarSubContent className="w-48">
              <Item onSelect={() => act((e) => e.insertField('page'))}>지금 쪽 번호</Item>
              <Item onSelect={() => act((e) => e.insertField('pages'))}>전체 쪽 수</Item>
            </MenubarSubContent>
          </MenubarSub>
        </MenubarGroup>
      </Menu>

      <Menu label="서식">
        <MenubarGroup>
          <MenubarSub>
            <MenubarSubTrigger className="pl-7">글자</MenubarSubTrigger>
            <MenubarSubContent className="w-52">
              <Check checked={!!ui?.marks.bold} shortcut="Ctrl+B" onSelect={() => act((e) => e.toggleMark('bold'))}>
                굵게
              </Check>
              <Check checked={!!ui?.marks.italic} shortcut="Ctrl+I" onSelect={() => act((e) => e.toggleMark('italic'))}>
                기울임
              </Check>
              <Check checked={!!ui?.marks.underline} shortcut="Ctrl+U" onSelect={() => act((e) => e.toggleMark('underline'))}>
                밑줄
              </Check>
              <Check checked={!!ui?.marks.strike} onSelect={() => act((e) => e.toggleMark('strike'))}>
                취소선
              </Check>
              <Check checked={ui?.marks.script === 'sup'} onSelect={() => act((e) => e.toggleScript('sup'))}>
                위 첨자
              </Check>
              <Check checked={ui?.marks.script === 'sub'} onSelect={() => act((e) => e.toggleScript('sub'))}>
                아래 첨자
              </Check>
              <MenubarSeparator />
              <Item onSelect={() => act((e) => e.clearMarks())}>서식 지우기</Item>
            </MenubarSubContent>
          </MenubarSub>
          <MenubarSub>
            <MenubarSubTrigger className="pl-7">쪽 나눔 제어</MenubarSubTrigger>
            <MenubarSubContent className="w-56">
              <Check checked={!!p?.pageBreakBefore} onSelect={() => act((e) => e.toggleParagraphKeep('pageBreakBefore'))}>
                문단 앞에서 쪽 나누기
              </Check>
              <Check checked={!!p?.keepWithNext} onSelect={() => act((e) => e.toggleParagraphKeep('keepWithNext'))}>
                다음 문단과 같은 쪽에
              </Check>
              <Check checked={!!p?.keepTogether} onSelect={() => act((e) => e.toggleParagraphKeep('keepTogether'))}>
                문단을 나누지 않기
              </Check>
            </MenubarSubContent>
          </MenubarSub>
          <MenubarSub>
            <MenubarSubTrigger className="pl-7">한글 조판</MenubarSubTrigger>
            <MenubarSubContent className="w-56">
              <MenubarGroup>
                <MenubarRadioGroup value={p?.koreanBreak ?? 'word'} onValueChange={(v) => act((e) => e.setParagraphAttr('koreanBreak', v === 'char' ? 'char' : undefined))}>
                  <MenubarRadioItem value="word">어절 단위로 줄 바꾸기</MenubarRadioItem>
                  <MenubarRadioItem value="char">글자 단위로 줄 바꾸기</MenubarRadioItem>
                </MenubarRadioGroup>
              </MenubarGroup>
              <MenubarSeparator />
              <Check checked={!!p?.hangPunct} onSelect={() => act((e) => e.setParagraphAttr('hangPunct', p?.hangPunct ? undefined : true))}>
                문장부호 내어 쓰기
              </Check>
              <Check checked={!!p?.squeeze} onSelect={() => act((e) => e.setParagraphAttr('squeeze', p?.squeeze ? undefined : true))}>
                줄 끝 공백 줄이기
              </Check>
            </MenubarSubContent>
          </MenubarSub>
        </MenubarGroup>
        <MenubarSeparator />
        <MenubarGroup>
          <Item icon={<Columns2 className={icon} />} onSelect={a.pageSetup}>
            쪽 설정·다단…
          </Item>
        </MenubarGroup>
      </Menu>

      <Menu label="표">
        <MenubarGroup>
          <Item onSelect={() => act((e) => e.insertTable(3, 3))}>표 넣기 (3×3)</Item>
        </MenubarGroup>
        <MenubarSeparator />
        <MenubarGroup>
          <Item disabled={!t?.inTable} onSelect={() => act((e) => e.tableAddRow(false))}>
            위에 행 넣기
          </Item>
          <Item disabled={!t?.inTable} onSelect={() => act((e) => e.tableAddRow(true))}>
            아래에 행 넣기
          </Item>
          <Item disabled={!t?.inTable} onSelect={() => act((e) => e.tableAddCol(false))}>
            왼쪽에 열 넣기
          </Item>
          <Item disabled={!t?.inTable} onSelect={() => act((e) => e.tableAddCol(true))}>
            오른쪽에 열 넣기
          </Item>
        </MenubarGroup>
        <MenubarSeparator />
        <MenubarGroup>
          <Item disabled={!t?.inTable} onSelect={() => act((e) => e.tableDelete('row'))}>
            행 지우기
          </Item>
          <Item disabled={!t?.inTable} onSelect={() => act((e) => e.tableDelete('col'))}>
            열 지우기
          </Item>
          <Item disabled={!t?.inTable} onSelect={() => act((e) => e.deleteTable())}>
            표 지우기
          </Item>
        </MenubarGroup>
        <MenubarSeparator />
        <MenubarGroup>
          <Item disabled={!t?.range} onSelect={() => act((e) => e.tableMerge())}>
            셀 합치기
          </Item>
          <Item disabled={!t?.merged} onSelect={() => act((e) => e.tableUnmerge())}>
            셀 나누기
          </Item>
        </MenubarGroup>
        <MenubarSeparator />
        <MenubarGroup>
          <Check disabled={!t?.inTable} checked={!!t?.header} onSelect={() => act((e) => e.tableSetRowFlag('header', !t?.header))}>
            제목 행 (쪽마다 반복)
          </Check>
          <Check disabled={!t?.inTable} checked={!!t?.cantSplit} onSelect={() => act((e) => e.tableSetRowFlag('cantSplit', !t?.cantSplit))}>
            행을 쪽에서 나누지 않기
          </Check>
        </MenubarGroup>
      </Menu>

      <Menu label="도구" wide>
        <MenubarGroup>
          <Check checked={!!ui?.spell} onSelect={a.toggleSpell}>
            맞춤법 검사 <Hint>(데모 검사기)</Hint>
          </Check>
          <Item onSelect={a.wordCount}>글자 수 세기</Item>
        </MenubarGroup>
        <MenubarSeparator />
        <MenubarGroup>
          <Check checked={!!ui?.suggesting} onSelect={() => act((e) => e.setSuggesting(!ui?.suggesting))}>
            제안 모드
          </Check>
          <Item disabled={!ui?.suggestions} onSelect={() => act((e) => e.acceptAll())}>
            제안 모두 수락
          </Item>
          <Item disabled={!ui?.suggestions} onSelect={() => act((e) => e.rejectAll())}>
            제안 모두 거부
          </Item>
        </MenubarGroup>
        <MenubarSeparator />
        <MenubarGroup>
          <Item shortcut="Ctrl+Alt+K" disabled={!ui?.hasSelection} onSelect={() => act((e) => e.run('highlightWords.addSelection'))}>
            강조 낱말로 더하기 <Hint>(플러그인)</Hint>
          </Item>
          <Item shortcut="Ctrl+Alt+J" onSelect={() => act((e) => e.run('highlightWords.next'))}>
            다음 강조 낱말로
          </Item>
        </MenubarGroup>
      </Menu>

      <Menu label="도움말">
        <MenubarGroup>
          <Item onSelect={a.shortcuts}>단축키</Item>
          <Item onSelect={a.about}>이 예제에 대해</Item>
        </MenubarGroup>
      </Menu>
    </Menubar>
  );
}
