import React, { useEffect, useMemo, useRef, useState } from 'react';

interface Step {
  title: string;
  content: string;
  images: {
    mobile?: string;
    web?: string;
  };
  platforms: ('mobile' | 'web')[];
  roles: string[];
}

interface InteractiveGuideProps {
  steps: Step[];
  availableRoles?: string[];
}

const InteractiveGuide: React.FC<InteractiveGuideProps> = ({
  steps,
  availableRoles = ['Membre', 'Staff', 'Club'],
}) => {
  const [selectedPlatform, setSelectedPlatform] = useState<'mobile' | 'web'>('mobile');
  const [selectedRole, setSelectedRole] = useState<string>(availableRoles[0]);
  const [currentStepIdx, setCurrentStepIdx] = useState(0);
  const [isMounted, setIsMounted] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const segmentRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setIsMounted(true);
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (!segmentRef.current || !pillRef.current) return;
    const activeBtn = segmentRef.current.querySelector(
      "button[data-active='true']",
    ) as HTMLElement | null;
    if (activeBtn) {
      pillRef.current.style.width = `${activeBtn.offsetWidth}px`;
      pillRef.current.style.left = `${activeBtn.offsetLeft}px`;
    }
  }, [selectedPlatform, isMounted]);

  const filteredSteps = useMemo(() => {
    return steps.filter(
      (step) => step.platforms.includes(selectedPlatform) && step.roles.includes(selectedRole),
    );
  }, [steps, selectedPlatform, selectedRole]);

  useEffect(() => {
    setCurrentStepIdx(0);
  }, [selectedPlatform, selectedRole]);

  if (!steps || steps.length === 0) return null;

  const currentStep = filteredSteps[currentStepIdx];
  const progress =
    filteredSteps.length > 0 ? ((currentStepIdx + 1) / filteredSteps.length) * 100 : 0;

  const nextStep = () => {
    if (currentStepIdx < filteredSteps.length - 1) {
      setCurrentStepIdx(currentStepIdx + 1);
    }
  };

  const prevStep = () => {
    if (currentStepIdx > 0) {
      setCurrentStepIdx(currentStepIdx - 1);
    }
  };

  if (!isMounted)
    return (
      <div
        className="ffd-guide ffd-guide-skeleton"
        style={{ minHeight: '420px' }}
        aria-hidden="true"
      />
    );

  return (
    <div className="ffd-guide" role="region" aria-label="Guide pas à pas">
      {/* Barre de filtres compacte */}
      <div className="ffd-guide-toolbar">
        <div className="ffd-guide-filters">
          <div className="ffd-guide-filter-group">
            <span className="ffd-guide-filter-label">Plateforme</span>
            <div className="ffd-guide-segmented" ref={segmentRef}>
              <div className="ffd-guide-segmented-pill" ref={pillRef} aria-hidden="true" />
              <button
                type="button"
                data-active={selectedPlatform === 'mobile'}
                className="ffd-guide-segmented-btn"
                onClick={() => setSelectedPlatform('mobile')}
                aria-pressed={selectedPlatform === 'mobile'}
              >
                <span className="ffd-guide-segmented-icon" aria-hidden="true">
                  📱
                </span>
                Mobile
              </button>
              <button
                type="button"
                data-active={selectedPlatform === 'web'}
                className="ffd-guide-segmented-btn"
                onClick={() => setSelectedPlatform('web')}
                aria-pressed={selectedPlatform === 'web'}
              >
                <span className="ffd-guide-segmented-icon" aria-hidden="true">
                  💻
                </span>
                Web
              </button>
            </div>
          </div>

          <div className="ffd-guide-filter-group" ref={dropdownRef}>
            <span className="ffd-guide-filter-label">Profil</span>
            <div
              className={`ffd-guide-dropdown ${isDropdownOpen ? 'is-open' : ''}`}
              onClick={() => setIsDropdownOpen(!isDropdownOpen)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setIsDropdownOpen(!isDropdownOpen);
                }
              }}
              role="button"
              tabIndex={0}
              aria-haspopup="listbox"
              aria-expanded={isDropdownOpen}
              aria-label="Choisir un profil"
            >
              <span className="ffd-guide-dropdown-value">
                <span className="ffd-guide-dropdown-icon" aria-hidden="true">
                  👤
                </span>
                {selectedRole}
              </span>
              <span className="ffd-guide-dropdown-arrow" aria-hidden="true">
                ▼
              </span>
              {isDropdownOpen && (
                <div
                  className="ffd-guide-dropdown-menu"
                  role="listbox"
                  aria-activedescendant={selectedRole}
                >
                  {availableRoles.map((role) => (
                    <button
                      type="button"
                      key={role}
                      role="option"
                      aria-selected={selectedRole === role}
                      className={`ffd-guide-dropdown-option ${selectedRole === role ? 'is-selected' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedRole(role);
                        setIsDropdownOpen(false);
                      }}
                    >
                      {role}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="ffd-guide-progress-wrap">
          <div className="ffd-guide-progress-track">
            <div className="ffd-guide-progress-fill" style={{ width: `${progress}%` }} />
          </div>
          <span className="ffd-guide-progress-label">
            Étape {currentStepIdx + 1} / {filteredSteps.length}
          </span>
        </div>
      </div>

      <div className="ffd-guide-body">
        {filteredSteps.length > 0 ? (
          <>
            <div className="ffd-guide-content">
              <h3 className="ffd-guide-step-title">{currentStep?.title}</h3>
              <div
                className="ffd-guide-step-description"
                dangerouslySetInnerHTML={{ __html: currentStep?.content ?? '' }}
              />

              <div className="ffd-guide-actions">
                <button
                  type="button"
                  onClick={prevStep}
                  disabled={currentStepIdx === 0}
                  className="ffd-guide-btn ffd-guide-btn-prev"
                >
                  Précédent
                </button>
                <button
                  type="button"
                  onClick={nextStep}
                  className="ffd-guide-btn ffd-guide-btn-next"
                >
                  {currentStepIdx === filteredSteps.length - 1 ? 'Terminer' : 'Suivant'}
                </button>
              </div>
            </div>

            <div className="ffd-guide-visual">
              <div className="ffd-guide-device-frame">
                {currentStep?.images?.[selectedPlatform] ? (
                  <img
                    src={currentStep.images[selectedPlatform]}
                    alt=""
                    className="ffd-guide-device-img"
                  />
                ) : (
                  <div className="ffd-guide-device-placeholder">
                    <span className="ffd-guide-placeholder-icon" aria-hidden="true">
                      📸
                    </span>
                    <p>Capture à venir</p>
                  </div>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="ffd-guide-empty">
            <span className="ffd-guide-empty-icon" aria-hidden="true">
              📂
            </span>
            <p>
              Aucune étape pour ce profil sur {selectedPlatform === 'mobile' ? 'Mobile' : 'Web'}.
            </p>
          </div>
        )}
      </div>

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .ffd-guide {
          margin: 2.5rem 0;
          border-radius: var(--ffd-radius-m);
          border: 1px solid var(--sl-color-hairline);
          background: var(--sl-color-bg-sidebar);
          overflow: hidden;
          font-family: var(--sl-font-system);
        }

        .ffd-guide-skeleton {
          background: var(--sl-color-bg-sidebar);
        }

        /* Toolbar */
        .ffd-guide-toolbar {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          justify-content: space-between;
          gap: 1rem;
          padding: 1rem 1.25rem;
          background: var(--sl-color-bg);
          border-bottom: 1px solid var(--sl-color-hairline);
        }

        .ffd-guide-filters {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 1.25rem;
        }

        .ffd-guide-filter-group {
          display: flex;
          flex-direction: column;
          gap: 0.35rem;
        }

        .ffd-guide-filter-label {
          font-size: 0.7rem;
          font-weight: 700;
          color: var(--sl-color-gray-3);
          text-transform: uppercase;
          letter-spacing: 0.08em;
        }

        .ffd-guide-segmented {
          display: inline-flex;
          position: relative;
          background: var(--sl-color-gray-6);
          padding: 4px;
          border-radius: var(--ffd-radius-s);
        }

        .ffd-guide-segmented-pill {
          position: absolute;
          top: 4px;
          bottom: 4px;
          left: 4px;
          width: 0;
          background: var(--sl-color-bg);
          border-radius: 4px;
          box-shadow: 0 1px 3px rgba(0,0,0,0.12);
          transition: width 0.2s ease, left 0.2s ease;
          pointer-events: none;
        }

        .ffd-guide-segmented-btn {
          border: none;
          background: transparent;
          color: var(--sl-color-gray-2);
          padding: 0.5rem 1rem;
          border-radius: 4px;
          font-size: 0.875rem;
          font-weight: 600;
          cursor: pointer;
          transition: color 0.2s;
          z-index: 1;
          display: inline-flex;
          align-items: center;
          gap: 0.35rem;
        }

        .ffd-guide-segmented-btn:hover {
          color: var(--sl-color-text);
        }

        .ffd-guide-segmented-btn[data-active="true"] {
          color: var(--sl-color-accent);
        }

        .ffd-guide-segmented-icon {
          font-size: 1rem;
        }

        .ffd-guide-dropdown {
          position: relative;
          min-width: 140px;
          background: var(--sl-color-gray-6);
          border-radius: var(--ffd-radius-s);
          cursor: pointer;
          user-select: none;
          border: 1px solid transparent;
          transition: border-color 0.2s, box-shadow 0.2s;
        }

        .ffd-guide-dropdown:hover,
        .ffd-guide-dropdown.is-open {
          border-color: var(--sl-color-hairline);
        }

        .ffd-guide-dropdown-value {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.5rem 2rem 0.5rem 0.75rem;
          font-size: 0.875rem;
          font-weight: 600;
          color: var(--sl-color-text);
        }

        .ffd-guide-dropdown-icon { font-size: 1rem; }
        .ffd-guide-dropdown-arrow {
          position: absolute;
          right: 0.75rem;
          top: 50%;
          transform: translateY(-50%);
          font-size: 0.6rem;
          color: var(--sl-color-gray-3);
          transition: transform 0.2s;
        }
        .ffd-guide-dropdown.is-open .ffd-guide-dropdown-arrow { transform: translateY(-50%) rotate(180deg); }

        .ffd-guide-dropdown-menu {
          position: absolute;
          top: calc(100% + 6px);
          left: 0;
          right: 0;
          background: var(--sl-color-bg-sidebar);
          border: 1px solid var(--sl-color-hairline);
          border-radius: var(--ffd-radius-s);
          box-shadow: 0 10px 25px rgba(0,0,0,0.15);
          z-index: 20;
          overflow: hidden;
        }

        .ffd-guide-dropdown-option {
          display: block;
          width: 100%;
          padding: 0.6rem 0.75rem;
          font-size: 0.875rem;
          text-align: left;
          background: transparent;
          border: none;
          cursor: pointer;
          font-family: inherit;
          color: var(--sl-color-text);
          transition: background 0.15s;
        }

        .ffd-guide-dropdown-option:hover {
          background: var(--sl-color-accent-low);
        }
        .ffd-guide-dropdown-option.is-selected {
          background: var(--sl-color-accent-low);
          color: var(--sl-color-accent);
          font-weight: 700;
        }

        .ffd-guide-progress-wrap {
          display: flex;
          align-items: center;
          gap: 0.75rem;
        }

        .ffd-guide-progress-track {
          width: 100px;
          height: 6px;
          background: var(--sl-color-gray-6);
          border-radius: 3px;
          overflow: hidden;
        }

        .ffd-guide-progress-fill {
          height: 100%;
          background: linear-gradient(90deg, var(--ffd-blue) 0%, var(--ffd-cyan) 100%);
          border-radius: 3px;
          transition: width 0.35s ease;
        }

        .ffd-guide-progress-label {
          font-size: 0.75rem;
          font-weight: 600;
          color: var(--sl-color-gray-3);
          white-space: nowrap;
        }

        /* Body */
        .ffd-guide-body {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 2rem;
          min-height: 380px;
          align-items: center;
        }

        @media (max-width: 900px) {
          .ffd-guide-body {
            grid-template-columns: 1fr;
            grid-template-rows: auto 1fr;
          }
          .ffd-guide-visual { order: -1; }
        }

        .ffd-guide-content {
          padding: 2rem 1.5rem;
          display: flex;
          flex-direction: column;
          gap: 1.25rem;
        }

        .ffd-guide-step-title {
          margin: 0;
          font-size: 1.5rem;
          font-weight: 700;
          color: var(--sl-color-text);
          line-height: 1.3;
        }

        .ffd-guide-step-description {
          font-size: 1rem;
          line-height: 1.6;
          color: var(--sl-color-gray-2);
        }
        .ffd-guide-step-description :global(strong) {
          color: var(--sl-color-text);
          font-weight: 600;
        }

        .ffd-guide-actions {
          display: flex;
          gap: 0.75rem;
          margin-top: 0.5rem;
        }

        .ffd-guide-btn {
          padding: 0.65rem 1.25rem;
          border-radius: var(--ffd-radius-s);
          font-size: 0.9375rem;
          font-weight: 600;
          cursor: pointer;
          transition: transform 0.15s, box-shadow 0.15s;
          border: none;
          font-family: inherit;
        }

        .ffd-guide-btn:disabled {
          opacity: 0.4;
          cursor: not-allowed;
          transform: none;
        }

        .ffd-guide-btn-prev {
          background: transparent;
          color: var(--sl-color-text);
          border: 1px solid var(--sl-color-hairline);
        }
        .ffd-guide-btn-prev:hover:not(:disabled) {
          background: var(--sl-color-gray-6);
        }

        .ffd-guide-btn-next {
          background: linear-gradient(135deg, var(--ffd-blue) 0%, var(--ffd-cyan) 100%);
          color: white;
          box-shadow: 0 4px 12px rgba(0, 68, 129, 0.35);
        }
        .ffd-guide-btn-next:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 6px 16px rgba(0, 136, 206, 0.4);
        }

        .ffd-guide-visual {
          padding: 1.5rem 2rem;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--sl-color-bg);
        }

        .ffd-guide-device-frame {
          width: 100%;
          max-width: 280px;
          aspect-ratio: 9 / 16;
          background: var(--ffd-slate-900);
          border-radius: var(--ffd-radius-l);
          border: 6px solid var(--ffd-slate-800);
          box-shadow: 0 25px 50px rgba(0,0,0,0.25);
          overflow: hidden;
        }

        .ffd-guide-device-img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .ffd-guide-device-placeholder {
          height: 100%;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 0.75rem;
          color: var(--sl-color-gray-4);
          font-size: 0.875rem;
        }
        .ffd-guide-placeholder-icon { font-size: 2.5rem; opacity: 0.5; }

        .ffd-guide-empty {
          grid-column: 1 / -1;
          padding: 4rem 2rem;
          text-align: center;
          color: var(--sl-color-gray-3);
        }
        .ffd-guide-empty-icon { font-size: 3rem; display: block; margin-bottom: 1rem; opacity: 0.4; }
      `,
        }}
      />
    </div>
  );
};

export default InteractiveGuide;
