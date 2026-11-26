/** Lower-cases and strips diacritics (NFD, then drop combining marks): "Pokémon" -> "pokemon". */
export function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}
