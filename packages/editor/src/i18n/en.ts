import type { MessageKey } from './ko';

/** 편집기 화면 문자열: 영어 (18 §3). 빠진 키가 없어야 한다 (시험) */
export const en: Record<MessageKey, string> = {
  'a11y.input': 'Document editing area',
  'a11y.document': 'Document content',
  'a11y.image': 'Image',

  'image.missing': 'Image not found',
  'image.missingAlt': 'Image not found: {alt}',
  'image.loading': 'Loading…',

  'break.section': 'Section break ({start})',
  'break.page': 'Page break',
  'break.column': 'Column break',
  'section.nextPage': 'Next page',
  'section.continuous': 'Continuous',
  'section.evenPage': 'Even page',
  'section.oddPage': 'Odd page',

  'hf.header': 'Header',
  'hf.headerFirst': 'First page header',
  'hf.headerEven': 'Even page header',
  'hf.footer': 'Footer',
  'hf.footerFirst': 'First page footer',
  'hf.footerEven': 'Even page footer',
  'hf.linked': '{label} · Same as previous',

  'layout.progress': 'Laying out pages… {percent}%',

  'author.me': 'Me',

  'suggestion.insert': 'Inserted “{text}”',
  'suggestion.delete': 'Deleted “{text}”',
  'suggestion.format': 'Formatted: {attrs} (“{text}”)',
  'suggestion.move': 'Moved paragraph (“{text}”)',
  'suggestion.paragraph': 'Paragraph: {attrs}',
  'suggestion.rowInsert': 'Table: inserted row',
  'suggestion.rowDelete': 'Table: deleted row',
  'suggestion.columnInsert': 'Table: inserted column',
  'suggestion.columnDelete': 'Table: deleted column',
  'list.separator': ', ',

  'attr.bold': 'Bold',
  'attr.italic': 'Italic',
  'attr.underline': 'Underline',
  'attr.strike': 'Strikethrough',
  'attr.size': 'Size',
  'attr.color': 'Color',
  'attr.highlight': 'Highlight',
  'attr.font': 'Font',
  'attr.sup': 'Superscript',
  'attr.sub': 'Subscript',
  'attr.link': 'Link',
  'attr.align': 'Alignment',
  'attr.style': 'Style',
  'attr.list': 'List',
  'attr.indent': 'Indent',
  'attr.spacing': 'Line spacing',

  'spell.noSuggestions': 'No suggestions',
  'spell.ignore': 'Ignore in this document',
  'spell.addWord': 'Add to dictionary',

  'wordCount.exporter': 'Document statistics (text)',
  'wordCount.report': 'Characters {chars} ({charsNoSpace} without spaces)\nWords {words}\nParagraphs {paragraphs}\n',
  'highlightWords.add': 'Add as highlighted word',
  'highlightWords.remove': 'Remove highlight: {word}',
};
