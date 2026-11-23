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
import { LOCALES, useI18n, type Locale } from '@/lib/i18n';
import type { AppMessageKey } from '@/lib/messages';
import { formatLabel } from './QuireApp';

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
  const tb = ui?.table;
  const icon = 'size-4 text-muted-foreground';
  const { t, locale, setLocale } = useI18n();
  return (
    <Menubar className="h-7 border-0 bg-transparent p-0 shadow-none">
      <Menu label={t('menu.file')} wide>
        <MenubarGroup>
          <Item icon={<FilePlus className={icon} />} onSelect={a.newDoc}>
            {t('file.new')}
          </Item>
          <Item icon={<FolderOpen className={icon} />} shortcut="Ctrl+O" onSelect={a.open}>
            {t('file.open')}
          </Item>
          <MenubarSub>
            <MenubarSubTrigger>
              <BookOpen className={icon} />
              {t('file.samples')}
            </MenubarSubTrigger>
            <MenubarSubContent className="w-72">
              <Item icon={<Sparkles className={icon} />} onSelect={a.tour}>
                {t('file.tour')}
              </Item>
              <MenubarSeparator />
              {SAMPLES.map((s) => (
                <Item key={s.id} icon={<FileText className={icon} />} onSelect={() => a.sample(s.id)}>
                  {t(`sample.${s.id}` as AppMessageKey)} <Hint>· {t(`sample.${s.id}.about` as AppMessageKey)}</Hint>
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
              {t('file.download')}
            </MenubarSubTrigger>
            <MenubarSubContent className="w-56">
              {SAVE_FORMATS.map((f) => (
                <Item key={f.kind} onSelect={() => a.save(f.kind)} shortcut={f.kind === 'quire' ? 'Ctrl+S' : undefined}>
                  {formatLabel(t, f)} <Hint>{f.ext}</Hint>
                </Item>
              ))}
            </MenubarSubContent>
          </MenubarSub>
          <Item icon={<PanelTop className={icon} />} onSelect={a.pageSetup}>
            {t('file.pageSetup')}
          </Item>
          <Item icon={<Printer className={icon} />} shortcut="Ctrl+P" onSelect={a.print}>
            {t('file.print')}
          </Item>
        </MenubarGroup>
      </Menu>

      <Menu label={t('menu.edit')}>
        <MenubarGroup>
          <Item icon={<Undo2 className={icon} />} shortcut="Ctrl+Z" disabled={!ui?.canUndo} onSelect={() => act((e) => e.undo())}>
            {t('edit.undo')}
          </Item>
          <Item icon={<Redo2 className={icon} />} shortcut="Ctrl+Y" disabled={!ui?.canRedo} onSelect={() => act((e) => e.redo())}>
            {t('edit.redo')}
          </Item>
        </MenubarGroup>
        <MenubarSeparator />
        <MenubarGroup>
          <Item icon={<Search className={icon} />} shortcut="Ctrl+F" onSelect={() => a.find(false)}>
            {t('edit.find')}
          </Item>
          <Item shortcut="Ctrl+H" onSelect={() => a.find(true)}>
            {t('edit.replace')}
          </Item>
        </MenubarGroup>
      </Menu>

      <Menu label={t('menu.view')}>
        <MenubarGroup>
          <Check checked={panels.outline} onSelect={() => a.togglePanel('outline')}>
            {t('view.outline')}
          </Check>
          <Check checked={panels.review} onSelect={() => a.togglePanel('review')}>
            {t('view.review')}
          </Check>
          <Check checked={!!ui?.formatMarks} onSelect={() => act((e) => e.setShowMarks(!ui?.formatMarks))}>
            {t('view.formatMarks')}
          </Check>
        </MenubarGroup>
        <MenubarSeparator />
        <MenubarGroup>
          <MenubarLabel>{t('view.documentView')}</MenubarLabel>
          <MenubarRadioGroup value={ui?.viewMode ?? 'suggestions'} onValueChange={(v) => act((e) => e.setViewMode(v as 'suggestions'))}>
            <MenubarRadioItem value="suggestions">{t('view.suggestions')}</MenubarRadioItem>
            <MenubarRadioItem value="final">{t('view.final')}</MenubarRadioItem>
            <MenubarRadioItem value="original">{t('view.original')}</MenubarRadioItem>
          </MenubarRadioGroup>
        </MenubarGroup>
        <MenubarSeparator />
        <MenubarGroup>
          <MenubarLabel>{t('app.language')}</MenubarLabel>
          <MenubarRadioGroup value={locale} onValueChange={(v) => setLocale(v as Locale)}>
            {LOCALES.map((l) => (
              <MenubarRadioItem key={l.id} value={l.id}>
                {l.label}
              </MenubarRadioItem>
            ))}
          </MenubarRadioGroup>
        </MenubarGroup>
      </Menu>

      <Menu label={t('menu.insert')}>
        <MenubarGroup>
          <Item icon={<ImagePlus className={icon} />} onSelect={a.image}>
            {t('insert.image')}
          </Item>
          <Item icon={<Table className={icon} />} onSelect={() => act((e) => e.insertTable(3, 3))}>
            {t('insert.table3')}
          </Item>
          <Item icon={<Link2 className={icon} />} onSelect={a.link}>
            {t('insert.link')}
          </Item>
          <Item icon={<MessageSquarePlus className={icon} />} shortcut="Ctrl+Alt+M" onSelect={a.comment}>
            {t('insert.comment')}
          </Item>
          <Item icon={<Footprints className={icon} />} onSelect={() => act((e) => e.insertFootnote())}>
            {t('insert.footnote')}
          </Item>
        </MenubarGroup>
        <MenubarSeparator />
        <MenubarGroup>
          <MenubarSub>
            <MenubarSubTrigger>
              <SeparatorHorizontal className={icon} />
              {t('insert.breaks')}
            </MenubarSubTrigger>
            <MenubarSubContent className="w-60">
              <Item shortcut="Ctrl+Enter" onSelect={() => act((e) => e.insertPageBreak())}>
                {t('insert.pageBreak')}
              </Item>
              <Item shortcut="Ctrl+Shift+Enter" onSelect={() => act((e) => e.insertColumnBreak())}>
                {t('insert.columnBreak')}
              </Item>
              <Item shortcut="Ctrl+Alt+Enter" onSelect={() => act((e) => e.insertSectionBreak('nextPage'))}>
                {t('insert.sectionNextPage')}
              </Item>
              <Item onSelect={() => act((e) => e.insertSectionBreak('continuous'))}>{t('insert.sectionContinuous')}</Item>
            </MenubarSubContent>
          </MenubarSub>
          <MenubarSub>
            <MenubarSubTrigger>
              <PanelTop className={icon} />
              {t('insert.headerFooter')}
            </MenubarSubTrigger>
            <MenubarSubContent className="w-48">
              <Item onSelect={() => act((e) => e.editHeaderFooter('header'))}>{t('insert.editHeader')}</Item>
              <Item onSelect={() => act((e) => e.editHeaderFooter('footer'))}>{t('insert.editFooter')}</Item>
            </MenubarSubContent>
          </MenubarSub>
          <MenubarSub>
            <MenubarSubTrigger>
              <FileText className={icon} />
              {t('insert.pageNumber')}
            </MenubarSubTrigger>
            <MenubarSubContent className="w-48">
              <Item onSelect={() => act((e) => e.insertField('page'))}>{t('insert.fieldPage')}</Item>
              <Item onSelect={() => act((e) => e.insertField('pages'))}>{t('insert.fieldPages')}</Item>
            </MenubarSubContent>
          </MenubarSub>
        </MenubarGroup>
      </Menu>

      <Menu label={t('menu.format')}>
        <MenubarGroup>
          <MenubarSub>
            <MenubarSubTrigger className="pl-7">{t('format.text')}</MenubarSubTrigger>
            <MenubarSubContent className="w-52">
              <Check checked={!!ui?.marks.bold} shortcut="Ctrl+B" onSelect={() => act((e) => e.toggleMark('bold'))}>
                {t('attr.bold')}
              </Check>
              <Check checked={!!ui?.marks.italic} shortcut="Ctrl+I" onSelect={() => act((e) => e.toggleMark('italic'))}>
                {t('attr.italic')}
              </Check>
              <Check checked={!!ui?.marks.underline} shortcut="Ctrl+U" onSelect={() => act((e) => e.toggleMark('underline'))}>
                {t('attr.underline')}
              </Check>
              <Check checked={!!ui?.marks.strike} onSelect={() => act((e) => e.toggleMark('strike'))}>
                {t('attr.strike')}
              </Check>
              <Check checked={ui?.marks.script === 'sup'} onSelect={() => act((e) => e.toggleScript('sup'))}>
                {t('attr.sup')}
              </Check>
              <Check checked={ui?.marks.script === 'sub'} onSelect={() => act((e) => e.toggleScript('sub'))}>
                {t('attr.sub')}
              </Check>
              <MenubarSeparator />
              <Item onSelect={() => act((e) => e.clearMarks())}>{t('format.clear')}</Item>
            </MenubarSubContent>
          </MenubarSub>
          <MenubarSub>
            <MenubarSubTrigger className="pl-7">{t('format.keep')}</MenubarSubTrigger>
            <MenubarSubContent className="w-56">
              <Check checked={!!p?.pageBreakBefore} onSelect={() => act((e) => e.toggleParagraphKeep('pageBreakBefore'))}>
                {t('format.pageBreakBefore')}
              </Check>
              <Check checked={!!p?.keepWithNext} onSelect={() => act((e) => e.toggleParagraphKeep('keepWithNext'))}>
                {t('format.keepWithNext')}
              </Check>
              <Check checked={!!p?.keepTogether} onSelect={() => act((e) => e.toggleParagraphKeep('keepTogether'))}>
                {t('format.keepTogether')}
              </Check>
            </MenubarSubContent>
          </MenubarSub>
          <MenubarSub>
            <MenubarSubTrigger className="pl-7">{t('format.korean')}</MenubarSubTrigger>
            <MenubarSubContent className="w-56">
              <MenubarGroup>
                <MenubarRadioGroup value={p?.koreanBreak ?? 'word'} onValueChange={(v) => act((e) => e.setParagraphAttr('koreanBreak', v === 'char' ? 'char' : undefined))}>
                  <MenubarRadioItem value="word">{t('format.breakWord')}</MenubarRadioItem>
                  <MenubarRadioItem value="char">{t('format.breakChar')}</MenubarRadioItem>
                </MenubarRadioGroup>
              </MenubarGroup>
              <MenubarSeparator />
              <Check checked={!!p?.hangPunct} onSelect={() => act((e) => e.setParagraphAttr('hangPunct', p?.hangPunct ? undefined : true))}>
                {t('format.hangPunct')}
              </Check>
              <Check checked={!!p?.squeeze} onSelect={() => act((e) => e.setParagraphAttr('squeeze', p?.squeeze ? undefined : true))}>
                {t('format.squeeze')}
              </Check>
            </MenubarSubContent>
          </MenubarSub>
        </MenubarGroup>
        <MenubarSeparator />
        <MenubarGroup>
          <Item icon={<Columns2 className={icon} />} onSelect={a.pageSetup}>
            {t('format.pageColumns')}
          </Item>
        </MenubarGroup>
      </Menu>

      <Menu label={t('menu.table')}>
        <MenubarGroup>
          <Item onSelect={() => act((e) => e.insertTable(3, 3))}>{t('table.insert3')}</Item>
        </MenubarGroup>
        <MenubarSeparator />
        <MenubarGroup>
          <Item disabled={!tb?.inTable} onSelect={() => act((e) => e.tableAddRow(false))}>
            {t('table.rowAbove')}
          </Item>
          <Item disabled={!tb?.inTable} onSelect={() => act((e) => e.tableAddRow(true))}>
            {t('table.rowBelow')}
          </Item>
          <Item disabled={!tb?.inTable} onSelect={() => act((e) => e.tableAddCol(false))}>
            {t('table.colLeft')}
          </Item>
          <Item disabled={!tb?.inTable} onSelect={() => act((e) => e.tableAddCol(true))}>
            {t('table.colRight')}
          </Item>
        </MenubarGroup>
        <MenubarSeparator />
        <MenubarGroup>
          <Item disabled={!tb?.inTable} onSelect={() => act((e) => e.tableDelete('row'))}>
            {t('table.deleteRow')}
          </Item>
          <Item disabled={!tb?.inTable} onSelect={() => act((e) => e.tableDelete('col'))}>
            {t('table.deleteCol')}
          </Item>
          <Item disabled={!tb?.inTable} onSelect={() => act((e) => e.deleteTable())}>
            {t('table.delete')}
          </Item>
        </MenubarGroup>
        <MenubarSeparator />
        <MenubarGroup>
          <Item disabled={!tb?.range} onSelect={() => act((e) => e.tableMerge())}>
            {t('table.merge')}
          </Item>
          <Item disabled={!tb?.merged} onSelect={() => act((e) => e.tableUnmerge())}>
            {t('table.unmerge')}
          </Item>
        </MenubarGroup>
        <MenubarSeparator />
        <MenubarGroup>
          <Check disabled={!tb?.inTable} checked={!!tb?.header} onSelect={() => act((e) => e.tableSetRowFlag('header', !tb?.header))}>
            {t('table.headerRow')}
          </Check>
          <Check disabled={!tb?.inTable} checked={!!tb?.cantSplit} onSelect={() => act((e) => e.tableSetRowFlag('cantSplit', !tb?.cantSplit))}>
            {t('table.cantSplit')}
          </Check>
        </MenubarGroup>
      </Menu>

      <Menu label={t('menu.tools')} wide>
        <MenubarGroup>
          <Check checked={!!ui?.spell} onSelect={a.toggleSpell}>
            {t('tools.spell')} <Hint>{t('tools.spellHint')}</Hint>
          </Check>
          <Item onSelect={a.wordCount}>{t('tools.wordCount')}</Item>
        </MenubarGroup>
        <MenubarSeparator />
        <MenubarGroup>
          <Check checked={!!ui?.suggesting} onSelect={() => act((e) => e.setSuggesting(!ui?.suggesting))}>
            {t('tools.suggesting')}
          </Check>
          <Item disabled={!ui?.suggestions} onSelect={() => act((e) => e.acceptAll())}>
            {t('tools.acceptAll')}
          </Item>
          <Item disabled={!ui?.suggestions} onSelect={() => act((e) => e.rejectAll())}>
            {t('tools.rejectAll')}
          </Item>
        </MenubarGroup>
        <MenubarSeparator />
        <MenubarGroup>
          <Item shortcut="Ctrl+Alt+K" disabled={!ui?.hasSelection} onSelect={() => act((e) => e.run('highlightWords.addSelection'))}>
            {t('highlightWords.add')} <Hint>{t('tools.pluginHint')}</Hint>
          </Item>
          <Item shortcut="Ctrl+Alt+J" onSelect={() => act((e) => e.run('highlightWords.next'))}>
            {t('tools.nextHighlight')}
          </Item>
        </MenubarGroup>
      </Menu>

      <Menu label={t('menu.help')}>
        <MenubarGroup>
          <Item onSelect={a.shortcuts}>{t('help.shortcuts')}</Item>
          <Item onSelect={a.about}>{t('help.about')}</Item>
        </MenubarGroup>
      </Menu>
    </Menubar>
  );
}
