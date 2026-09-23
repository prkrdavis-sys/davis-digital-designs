export interface Testimonial {
  quote: string;
  name: string;
  role: string;
  accent: string;
}

/** Swap these for real quotes as they come in. */
export const TESTIMONIALS: Testimonial[] = [
  {
    quote: "The site finally looks like how our sessions feel. Calm, warm, and somehow it moves.",
    name: "Client, Wunderful Life",
    role: "Founder",
    accent: "#ff7bac",
  },
  {
    quote: "We stopped getting 'where do I find this' emails within a week of launch.",
    name: "Program Director",
    role: "VTCC",
    accent: "#5fb9e6",
  },
  {
    quote: "Admin work that used to eat a Friday now takes an hour. The dashboard just makes sense.",
    name: "Operations Lead",
    role: "Caregiver ABA",
    accent: "#ffb84d",
  },
  {
    quote: "Our launch week filled the cohort. The templates made every post look like the same brand.",
    name: "Director",
    role: "Code Academy",
    accent: "#a78bfa",
  },
];
