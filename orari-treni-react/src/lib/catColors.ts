export function getCatColors(cat: string): [string, string] {
  if (/FR|AV/.test(cat))  return ['bg-danger',   'text-white'];
  if (/ICN/.test(cat))    return ['bg-cat-icn',   'text-white'];
  if (/IC/.test(cat))     return ['bg-cat-ic',    'text-white'];
  if (/EC/.test(cat))     return ['bg-warning',   'text-dark'];
  if (/REG|RV/.test(cat)) return ['bg-success',   'text-white'];
  return ['bg-secondary', 'text-white'];
}
