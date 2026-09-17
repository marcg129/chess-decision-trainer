export type AppSection = 'train' | 'play' | 'data';

const sections: Array<{ id: AppSection; label: string }> = [
  { id: 'train', label: 'Train' },
  { id: 'play', label: 'Play' },
  { id: 'data', label: 'Data' },
];

export function AppNav({
  current,
  onChange,
}: {
  current: AppSection;
  onChange: (section: AppSection) => void;
}) {
  return (
    <nav className="app-nav" aria-label="Chess Decision Trainer sections">
      <div className="app-nav__tabs" role="tablist" aria-label="App sections">
        {sections.map((section) => (
          <button
            key={section.id}
            type="button"
            role="tab"
            aria-selected={current === section.id}
            aria-controls={`app-panel-${section.id}`}
            id={`app-tab-${section.id}`}
            className={current === section.id ? 'is-active' : undefined}
            onClick={() => onChange(section.id)}
          >
            {section.label}
          </button>
        ))}
      </div>
    </nav>
  );
}
