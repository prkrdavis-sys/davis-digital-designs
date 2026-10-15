export interface Testimonial {
  quote: string;
  name: string;
  role: string;
  accent: string;
}

/** Swap these for real quotes as they come in. */
export const TESTIMONIALS: Testimonial[] = [
  {
    quote: "The portfolio finally shows the work the way it should. Calm, clear, and somehow it moves.",
    name: "Client",
    role: "Content creator",
    accent: "#ff7bac",
  },
  {
    quote: "We stopped getting 'where do I find this' emails within a week of launch.",
    name: "Program Director",
    role: "Therapeutic clinic",
    accent: "#5fb9e6",
  },
  {
    quote: "Admin work that used to eat a Friday now takes an hour. The dashboard just makes sense.",
    name: "Operations Lead",
    role: "Clinic operations",
    accent: "#ffb84d",
  },
  {
    quote: "People stayed for the lessons, not just the game. It finally feels like a place to learn.",
    name: "Director",
    role: "Code Academy",
    accent: "#a78bfa",
  },
];
