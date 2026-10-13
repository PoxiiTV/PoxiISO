export type Dict = Record<string, string>

export function createT(es: Dict, en: Dict) {
  return (key: string, vars: Record<string, string | number> = {}): string => {
    const s = es[key] ?? en[key] ?? key
    return s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m))
  }
}
