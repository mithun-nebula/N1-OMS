export interface NewsItem {
  title: string;
  summary: string;
  affectsCourse?: string;
  url?: string;
}

export function getNews(): NewsItem[] {
  return [
    {
      title: "Major update to a tool you teach",
      summary: "A new version shipped this week with breaking changes to the APIs your course covers.",
      affectsCourse: "ai-presentations",
    },
    {
      title: "AI for Data Analysis — new dataset formats",
      summary: "Widely-used libraries added support for newer dataset formats.",
      affectsCourse: "ai-data-analysis",
    },
    {
      title: "Spreadsheet automation ergonomics",
      summary: "Automation tooling released improved macro recording.",
      affectsCourse: "spreadsheet-automation",
    },
  ];
}
