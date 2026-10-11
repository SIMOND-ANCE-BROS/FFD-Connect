import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { AppDemo, type DemoView } from './ffd-demo';

function GuidePreview({ initialView }: { initialView: DemoView }) {
  const [view, setView] = useState(initialView);
  const [revision, setRevision] = useState(0);
  return (
    <div className="guide-preview">
      <button
        className="button button-outline"
        onClick={() => {
          setView(initialView);
          setRevision((value) => value + 1);
        }}
      >
        Recommencer l’aperçu
      </button>
      <AppDemo key={`${view}-${revision}`} view={view} onNavigate={setView} />
    </div>
  );
}

export function mountGuidePreview(element: Element, view: string) {
  if (!['licence', 'competitions', 'audio', 'organisation'].includes(view))
    throw new Error('Unknown guide preview');
  const root = createRoot(element);
  root.render(<GuidePreview initialView={view as DemoView} />);
}
