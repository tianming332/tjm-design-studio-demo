/** Code-native boolean-operation icons; shared across options and path panels. */
export function BooleanIcon({ operation }: { operation: string }) {
  const a = 'M3 3h11v11H3z', b = 'M10 10h11v11H10z';
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true">
    {operation === 'new' ? <><path d={a} fill="currentColor" fillOpacity=".15" /><path d="M18 13v9m-4-4.5h8" /></>
      : operation === 'combine' || operation === 'merge' ? <path d="M3 3h11v7h7v11H10v-7H3z" fill="currentColor" fillOpacity=".23" />
      : operation === 'subtract' ? <><path d="M3 3h11v7h-4v4H3z" fill="currentColor" fillOpacity=".23" /><path d={b} strokeDasharray="2 2" opacity=".45" /></>
      : operation === 'intersect' ? <><path d={`${a}${b}`} opacity=".35" /><path d="M10 10h4v4h-4z" fill="currentColor" /></>
      : <><path d={`${a}${b}`} fill="currentColor" fillOpacity=".23" fillRule="evenodd" /><path d="M10 10h4v4h-4z" strokeDasharray="1 2" /></>}
  </svg>;
}
