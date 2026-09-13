/** Original vector drawings. Metadata is indexed exactly like generated artwork. */
export const ART = [
  {
    id: "window",
    title: "A friendly web page",
    keywords: ["landing", "website", "web", "ui", "страница", "лендинг", "сайт", "интерфейс"],
    description:
      "A hand-drawn browser window, picture and mouse cursor. Building a friendly website.",
  },
  {
    id: "cube",
    title: "Build something useful",
    keywords: [
      "product",
      "development",
      "engineering",
      "build",
      "продукт",
      "разработка",
      "система",
    ],
    description:
      "An open geometric cube with radiating pen strokes, representing building a product.",
  },
  {
    id: "megaphone",
    title: "Tell the story",
    keywords: [
      "marketing",
      "launch",
      "growth",
      "social",
      "маркетинг",
      "запуск",
      "контент",
      "реклама",
    ],
    description: "A hand-drawn megaphone with sound rays. Sharing a story and launching a product.",
  },
  {
    id: "book",
    title: "Keep learning",
    keywords: [
      "research",
      "learn",
      "docs",
      "documentation",
      "исследование",
      "документация",
      "учеба",
    ],
    description:
      "An open notebook with uneven pages, a bookmark and small stars, representing knowledge.",
  },
  {
    id: "sprout",
    title: "Make room to grow",
    keywords: ["ideas", "future", "people", "team", "идеи", "команда", "будущее", "рост"],
    description:
      "A small sprouting plant, rounded leaves and a little sun, representing people and growing ideas.",
  },
  {
    id: "flag",
    title: "One step at a time",
    keywords: ["goals", "roadmap", "milestone", "plan", "цель", "план", "этап"],
    description:
      "A winding path climbing a mountain to a little flag. Plans, milestones and progress.",
  },
];
const parts = {
  window: `<path fill="#d8e0e9" stroke="none" opacity=".65" d="M31 61Q30 51 43 50L93 47Q105 47 105 59L108 102Q108 112 93 112L39 115Q30 115 31 103Z"/><path d="M15 37Q13 21 32 20L177 11Q196 10 198 28L202 113M17 43L198 33M18 43L20 116Q20 134 37 132L161 124"/><path stroke-width="3" d="M37 105L52 85Q55 82 58 86L68 97L87 76Q90 72 93 77L109 100M123 55L176 50M124 74L167 70M125 92L151 88M176 98L180 153L192 136L207 150L215 143L199 127L217 119Z"/><g fill="currentColor" stroke="none"><circle cx="33" cy="32" r="3"/><circle cx="46" cy="31" r="3"/><circle cx="60" cy="30" r="3"/></g><path d="M217 88L224 81M224 100L235 99"/>`,
  cube: `<path fill="#e4e9ee" stroke="none" d="M80 77L132 56L180 79L178 134L130 161L79 136Z"/><path d="M130 57L81 80L82 135L132 160L181 134L180 80Z M82 80L131 105L180 80M131 105L132 160" stroke-width="3.4"/><path d="M50 95L31 92M65 60L46 44M113 36L109 12M157 40L168 20M199 70L219 59M204 119L225 121M181 152L196 168"/>`,
  megaphone: `<path fill="#dce6eb" opacity=".65" stroke="none" d="M47 84L89 73L141 35L162 119L96 111L60 120Z"/><path d="M57 83Q35 90 43 111Q47 125 64 119L94 110L160 125M57 83L89 73L140 34M52 86L60 118M89 73L96 109M72 118L84 157Q87 164 97 159L105 156L91 113"/><path d="M140 35Q140 18 147 27Q160 48 167 98Q174 132 160 125Q149 119 140 62Q137 44 140 35Z"/><path fill="currentColor" stroke="none" d="M145 61Q158 58 158 81Q150 80 150 78Z"/><path d="M184 43L198 23M194 66L218 54M198 92L223 102"/>`,
  book: `<path fill="#e6e9ef" stroke="none" d="M31 42L98 32L124 52L147 35L205 31L208 138L141 143L122 156L99 140L28 142Z"/><path d="M30 43Q90 24 122 53Q160 29 207 32L209 137Q151 130 123 156Q83 136 29 143Z M122 54L123 154M49 64L92 59M49 82L98 79M48 101L93 98M145 66L188 59M147 85L185 79M148 104L190 98"/><path d="M170 37L171 11L180 20L190 9L192 32M221 16L225 29M217 25L230 21"/>`,
  sprout: `<path fill="#dde8df" stroke="none" d="M118 92Q59 93 57 37Q112 36 119 84M120 85Q130 31 183 31Q186 84 123 95"/><path d="M119 144Q124 109 117 80M118 95Q67 95 56 39Q106 31 118 85M122 91Q128 37 184 32Q188 76 123 95M67 50L116 94M171 45L126 89M74 147Q121 137 167 147M87 158L148 157"/><circle cx="54" cy="121" r="7"/><path d="M194 112L194 127M185 120L202 119M30 45L25 35M51 22L50 9"/>`,
  flag: `<path d="M34 149Q57 120 84 110Q105 73 129 77Q148 83 158 102L193 128M40 165Q91 140 110 135Q132 125 107 119Q76 111 111 98Q135 90 118 84M129 75L129 28Q138 21 150 28L147 37Q138 32 130 40"/><path d="M110 22L105 13M129 12L128 2M149 13L155 5M166 33L175 29"/>`,
};
export function artSVG(id, { className = "doodle" } = {}) {
  return `<svg class="${className}" viewBox="0 0 250 180" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${parts[id] || parts.sprout}</svg>`;
}
export function pickArt(text) {
  const s = String(text).toLowerCase();
  return ART.map((a) => ({ a, n: a.keywords.filter((k) => s.includes(k)).length })).sort(
    (a, b) => b.n - a.n,
  )[0]?.n
    ? ART.map((a) => ({ a, n: a.keywords.filter((k) => s.includes(k)).length })).sort(
        (a, b) => b.n - a.n,
      )[0].a.id
    : "sprout";
}
