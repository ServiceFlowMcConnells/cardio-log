/** The RLNTLS mark, faint in the corner of hero cards. */
export default function Chevrons() {
  return (
    <svg className="hero-chev" viewBox="0 0 512 512" aria-hidden="true">
      {[425, 323, 221].map((y, i) => <path key={y} d={`M126 ${y - 7} L256 ${y - 125} L386 ${y - 7}`} fill="none" stroke="currentColor" strokeOpacity={[0.35, 0.6, 1][i]} strokeWidth="47" strokeLinecap="square" strokeLinejoin="miter" />)}
    </svg>
  );
}
