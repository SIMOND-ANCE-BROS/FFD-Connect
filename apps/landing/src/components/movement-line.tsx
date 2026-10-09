/** A simple, non-representational line shared by the site's compositions. */
export function MovementLine({ className = '' }: { className?: string }) {
  return (
    <svg
      className={'movement-line ' + className}
      viewBox="0 0 720 520"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        className="movement-track"
        d="M-40 450C125 450 143 354 201 273C268 179 463 139 508 252C559 381 373 465 286 356C181 225 409 37 758 62"
      />
      <path
        className="movement-stroke"
        pathLength="1"
        d="M-40 450C125 450 143 354 201 273C268 179 463 139 508 252C559 381 373 465 286 356C181 225 409 37 758 62"
      />
      <circle cx="508" cy="252" r="6" fill="currentColor" />
    </svg>
  );
}
