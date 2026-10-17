import './ailo-mark.css';

/** Local six-loop mark inspired by ChatGPT's interwoven silhouette. */
export function AiloMark() {
  return <span className="ailo-mark" aria-hidden="true"><svg viewBox="0 0 32 32" fill="none">
    <g className="ailo-mark-knot" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
      {[0,60,120,180,240,300].map(angle => <path key={angle} transform={`rotate(${angle} 16 16)`} d="M16 6.3c-4.7-2.7-10 .7-10 5.2 0 2.3 1.1 4.1 3.1 5.3l6.9 4V10.6l6.8-3.9"/>)}
    </g>
  </svg></span>;
}
