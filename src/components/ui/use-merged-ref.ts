import * as React from "react";

function assign<T>(ref: React.Ref<T> | undefined, el: T | null) {
  if (typeof ref === "function") ref(el);
  else if (ref) (ref as React.RefObject<T | null>).current = el;
}

/** مرجع داخلي مدموج مع المرجع القادم من الخارج (مثل register في React Hook Form) */
export function useMergedRef<T>(outer: React.Ref<T> | undefined) {
  const inner = React.useRef<T | null>(null);
  const set = React.useCallback((el: T | null) => { assign(inner, el); assign(outer, el); }, [outer]);
  return [inner, set] as const;
}
