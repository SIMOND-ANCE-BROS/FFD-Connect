import { motion } from 'framer-motion';
import { useGitHubRoadmap, type Milestone, type RoadmapIssue } from './useGitHubRoadmap';

const springSoft = { type: 'spring' as const, stiffness: 60, damping: 18 };

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' });
}

function groupIssuesByMilestone(
  issues: RoadmapIssue[],
  milestones: Milestone[],
): Map<number | 'backlog', RoadmapIssue[]> {
  const map = new Map<number | 'backlog', RoadmapIssue[]>();
  const milestoneIds = new Set(milestones.map((m) => m.id));

  for (const m of milestones) {
    map.set(m.id, []);
  }
  map.set('backlog', []);

  for (const issue of issues) {
    const mid = issue.milestone?.id;
    const key = mid && milestoneIds.has(mid) ? mid : 'backlog';
    map.get(key)!.push(issue);
  }

  return map;
}

export function RoadmapSection() {
  const { data, loading, error } = useGitHubRoadmap();

  if (loading) {
    return (
      <section className="roadmap" id="roadmap">
        <div className="roadmap-inner">
          <motion.h2
            className="roadmap-title"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            Feuille de route
          </motion.h2>
          <p className="roadmap-subtitle">Liée à GitHub</p>
          <div className="roadmap-loading">
            <div className="roadmap-loading-dots" />
            <p>Chargement de la roadmap…</p>
          </div>
        </div>
      </section>
    );
  }

  const milestones = data?.milestones ?? [];
  const issues = data?.issues ?? [];
  const grouped = groupIssuesByMilestone(issues, milestones);

  const backlogIssues = grouped.get('backlog') ?? [];
  const hasContent = milestones.length > 0 || issues.length > 0;
  const repoUrl = `https://github.com/${import.meta.env.VITE_GITHUB_REPO || 'GabinSMD/FFD-Connect'}`;

  return (
    <section className="roadmap" id="roadmap">
      <div className="roadmap-inner">
        <motion.h2
          className="roadmap-title"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={springSoft}
        >
          Feuille de route
        </motion.h2>
        <motion.p
          className="roadmap-subtitle"
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 0.1 }}
        >
          Mise à jour en direct depuis{' '}
          <a href={repoUrl} target="_blank" rel="noopener noreferrer" className="roadmap-link">
            GitHub
          </a>
        </motion.p>

        {error && (
          <motion.div
            className="roadmap-error"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            style={{
              textAlign: 'center',
              padding: '2rem',
              background: 'var(--surface)',
              borderRadius: '16px',
              border: '1px solid var(--border)',
              marginTop: '1rem',
            }}
          >
            <p style={{ marginBottom: '1rem', color: 'var(--text-secondary)' }}>
              Impossible de charger la roadmap en direct (limite d'API GitHub atteinte).
            </p>
            <a
              href={repoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-secondary"
              style={{
                display: 'inline-flex',
                padding: '0.5rem 1rem',
                fontSize: '0.9rem',
              }}
            >
              Consulter sur GitHub →
            </a>
          </motion.div>
        )}

        {hasContent ? (
          <div className="roadmap-grid">
            {milestones.map((milestone, i) => {
              const msIssues = grouped.get(milestone.id) ?? [];
              if (msIssues.length === 0 && milestone.open_issues === 0) return null;

              // Emphasize the first incomplete milestone
              const isNextRelease = i === 0;

              return (
                <motion.div
                  key={milestone.id}
                  className={`roadmap-bento-card ${isNextRelease ? 'active-milestone' : ''}`}
                  initial={{ opacity: 0, y: 30 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: '-100px' }}
                  transition={{ ...springSoft, delay: i * 0.1 }}
                >
                  <div className="roadmap-card-header">
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: '1rem',
                      }}
                    >
                      <h3
                        style={{
                          fontSize: '1.2rem',
                          fontWeight: 600,
                          color: '#fff',
                        }}
                      >
                        {milestone.title}
                      </h3>
                      {milestone.due_on && (
                        <span
                          style={{
                            fontSize: '0.85rem',
                            color: 'var(--ffd-cyan)',
                            background: 'rgba(0,136,206,0.1)',
                            padding: '0.2rem 0.6rem',
                            borderRadius: '100px',
                            border: '1px solid rgba(0,136,206,0.3)',
                          }}
                        >
                          {formatDate(milestone.due_on)}
                        </span>
                      )}
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.5rem',
                      }}
                    >
                      {msIssues.map((issue) => (
                        <a
                          key={issue.id}
                          href={issue.html_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.5rem',
                            color: 'var(--text-secondary)',
                            textDecoration: 'none',
                            fontSize: '0.95rem',
                            transition: 'color 0.2s',
                          }}
                          onMouseOver={(e) => (e.currentTarget.style.color = '#fff')}
                          onMouseOut={(e) =>
                            (e.currentTarget.style.color = 'var(--text-secondary)')
                          }
                        >
                          <span
                            style={{
                              color: 'var(--text-muted)',
                              fontFamily: 'monospace',
                              fontSize: '0.85rem',
                            }}
                          >
                            #{issue.number}
                          </span>
                          <span>{issue.title}</span>
                        </a>
                      ))}
                    </div>
                  </div>
                </motion.div>
              );
            })}

            {backlogIssues.length > 0 && (
              <motion.div
                className="roadmap-bento-card backlog-card"
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-100px' }}
                transition={{ ...springSoft, delay: 0.3 }}
              >
                <div className="roadmap-card-header" style={{ marginBottom: '1rem' }}>
                  <h3
                    style={{
                      fontSize: '1.2rem',
                      fontWeight: 600,
                      color: 'var(--text-secondary)',
                    }}
                  >
                    À planifier
                  </h3>
                </div>
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.5rem',
                  }}
                >
                  {backlogIssues.map((issue) => (
                    <a
                      key={issue.id}
                      href={issue.html_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        color: 'var(--text-muted)',
                        textDecoration: 'none',
                        fontSize: '0.95rem',
                        transition: 'color 0.2s',
                      }}
                      onMouseOver={(e) => (e.currentTarget.style.color = '#fff')}
                      onMouseOut={(e) => (e.currentTarget.style.color = 'var(--text-muted)')}
                    >
                      <span
                        style={{
                          fontFamily: 'monospace',
                          fontSize: '0.85rem',
                        }}
                      >
                        #{issue.number}
                      </span>
                      <span>{issue.title}</span>
                    </a>
                  ))}
                </div>
              </motion.div>
            )}
          </div>
        ) : (
          <motion.div
            className="roadmap-empty"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
          >
            <p>
              Aucune roadmap configurée pour l’instant. Créez des milestones et des issues avec le
              label <code>roadmap</code> sur GitHub pour les afficher ici.
            </p>
            <a
              href={`${repoUrl}/issues/new`}
              target="_blank"
              rel="noopener noreferrer"
              className="roadmap-empty-cta"
            >
              Créer une issue →
            </a>
          </motion.div>
        )}
      </div>
    </section>
  );
}
