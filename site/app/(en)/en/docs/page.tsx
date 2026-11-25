import type { Metadata } from 'next';
import Docs from '../../../components/Docs';

export const metadata: Metadata = { title: 'API reference', description: 'The public API of Quire 0.2: editor options, commands, state, React, saving, conversion, PDF, plugins, themes, languages, collaboration.' };

export default function Page() {
  return <Docs lang="en" />;
}
