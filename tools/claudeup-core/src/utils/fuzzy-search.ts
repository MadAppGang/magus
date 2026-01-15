export interface FuzzySearchOptions {
  keys?: string[];
  threshold?: number;
}

export function fuzzySearch<T>(
  items: T[],
  query: string,
  options: FuzzySearchOptions = {}
): T[] {
  const { keys = [], threshold = 0.3 } = options;

  if (!query) {
    return items;
  }

  const normalizedQuery = query.toLowerCase();

  return items
    .map((item) => {
      let text = "";

      if (keys.length > 0) {
        text = keys
          .map((key) => {
            const value = (item as any)[key];
            return typeof value === "string" ? value : "";
          })
          .join(" ");
      } else if (typeof item === "string") {
        text = item;
      }

      const normalizedText = text.toLowerCase();
      const score = calculateFuzzyScore(normalizedText, normalizedQuery);

      return { item, score };
    })
    .filter(({ score }) => score >= threshold)
    .sort((a, b) => b.score - a.score)
    .map(({ item }) => item);
}

function calculateFuzzyScore(text: string, query: string): number {
  if (text.includes(query)) {
    return 1.0;
  }

  let queryIndex = 0;
  let textIndex = 0;
  let matches = 0;

  while (queryIndex < query.length && textIndex < text.length) {
    if (query[queryIndex] === text[textIndex]) {
      matches++;
      queryIndex++;
    }
    textIndex++;
  }

  if (queryIndex !== query.length) {
    return 0;
  }

  return matches / text.length;
}
