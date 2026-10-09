import { sitePath } from '../lib/ffd';

import { useRef, useState } from 'react';
import { GitBranch, Menu, X } from 'lucide-react';
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetTitle,
  SheetDescription,
  SheetClose,
} from './ui/sheet';
import { MovementLine } from './movement-line';
import { repository, betaUrl } from '../lib/ffd';

export function Brand() {
  return (
    <a href={sitePath('')} className="brand" aria-label="FFD Connect, accueil">
      <img src={sitePath('app-logo.png')} width="36" height="36" alt="" />
      <span>
        FFD{' '}
        <b>
          Connect<span>.</span>
        </b>
      </span>
    </a>
  );
}

export function SiteHeader({ documentation = false }: { documentation?: boolean }) {
  const [open, setOpen] = useState(false);
  const destination = useRef<string | null>(null);
  const prefix = documentation ? sitePath('') : '';
  const links = [
    { href: prefix + '#modules', label: 'L’application' },
    { href: prefix + '#profils', label: 'Pour qui ?' },
    { href: prefix + '#roadmap', label: 'Le projet' },
    { href: sitePath('documentation/'), label: 'Documentation' },
  ];
  return (
    <>
      <a className="skip-link" href="#contenu">
        Aller au contenu
      </a>
      <header className="site-header">
        <div className="header-inner">
          <Brand />
          <nav className="desktop-navigation" aria-label="Navigation principale">
            {links.map((link) => (
              <a
                key={link.href}
                href={link.href}
                aria-current={
                  documentation && link.href === sitePath('documentation/') ? 'page' : undefined
                }
              >
                {link.label}
              </a>
            ))}
          </nav>
          <a href={betaUrl} className="header-cta">
            Rejoindre la bêta
          </a>
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <button className="menu-toggle" type="button" aria-label="Ouvrir le menu">
                <Menu size={24} />
              </button>
            </SheetTrigger>
            <SheetContent
              className="mobile-sheet"
              showCloseButton={false}
              onCloseAutoFocus={(event) => {
                if (!destination.current) return;
                event.preventDefault();
                const id = destination.current;
                destination.current = null;
                requestAnimationFrame(() => {
                  const target = document.getElementById(id);
                  target?.focus({ preventScroll: true });
                  target?.scrollIntoView({
                    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
                      ? 'instant'
                      : 'smooth',
                    block: 'start',
                  });
                });
              }}
            >
              <div className="sheet-top">
                <SheetTitle className="sheet-title">FFD Connect</SheetTitle>
                <SheetClose asChild>
                  <button type="button" aria-label="Fermer le menu">
                    <X size={24} />
                  </button>
                </SheetClose>
              </div>
              <SheetDescription className="sheet-description">
                La danse, connectée.
              </SheetDescription>
              <nav aria-label="Navigation mobile">
                {links.map((link, i) => (
                  <a
                    href={link.href}
                    key={link.href}
                    onClick={(event) => {
                      if (link.href.startsWith('#')) {
                        event.preventDefault();
                        destination.current = link.href.slice(1);
                        window.history.pushState(null, '', link.href);
                      }
                      setOpen(false);
                    }}
                  >
                    <span aria-hidden="true">0{i + 1}</span>
                    {link.label}
                  </a>
                ))}
              </nav>
              <a href={betaUrl} className="button button-primary">
                Rejoindre la bêta
              </a>
              <a href={repository} className="text-link" target="_blank" rel="noreferrer">
                <GitBranch size={18} />
                Le projet sur GitHub
              </a>
            </SheetContent>
          </Sheet>
        </div>
      </header>
    </>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="section-width">
        <div className="footer-top">
          <Brand />
          <nav aria-label="Liens de pied de page">
            <a href={sitePath('documentation')}>Documentation</a>
            <a href={repository} target="_blank" rel="noreferrer">
              GitHub
            </a>
            <a href={repository + '/issues'} target="_blank" rel="noreferrer">
              Signaler un problème
            </a>
          </nav>
        </div>
        <div className="footer-signature">
          <p>
            Le mouvement
            <br />
            <em>nous relie.</em>
          </p>
          <MovementLine />
        </div>
        <div className="footer-bottom">
          <p>
            © 2026 Gabin Simond · Projet indépendant, non affilié à la Fédération Française de
            Danse.
          </p>
          <nav aria-label="Informations légales">
            <a href="https://ffd.gabin-simond.fr/confidentialite/">Confidentialité</a>
            <a href="https://ffd.gabin-simond.fr/cgu/">CGU</a>
            <a href={sitePath('mentions-legales/')}>Mentions légales</a>
            <a href={sitePath('suppression-compte/')}>Suppression du compte</a>
          </nav>
        </div>
      </div>
    </footer>
  );
}
