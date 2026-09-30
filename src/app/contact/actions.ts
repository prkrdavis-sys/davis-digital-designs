"use server";

import { Resend } from "resend";
import { z } from "zod";
import { getInterestGroups, type InterestGroup } from "@/lib/content";

const CONTACT_TO = process.env.CONTACT_TO_EMAIL ?? "hello@davisdigitaldesigns.com";
const CONTACT_FROM = process.env.CONTACT_FROM_EMAIL ?? "Davis Digital Designs <onboarding@resend.dev>";

function optionalTags(options: string[]) {
  const allowed = new Set(options);
  return z
    .array(z.string())
    .max(options.length)
    .default([])
    .refine((values) => values.every((value) => allowed.has(value)), "Pick from the list.");
}

function contactSchema(groups: InterestGroup[]) {
  const tags = Object.fromEntries(groups.map((group) => [group.id, optionalTags(group.options)]));
  return z.object({
    name: z.string().trim().min(2, "Tell me your name (at least 2 letters)."),
    email: z.string().trim().email("That email doesn't look right."),
    subject: z.string().trim().max(120).optional().default(""),
    budget: z.string().trim().max(60).optional().default(""),
    message: z.string().trim().min(10, "Give me a little more to go on (10+ characters)."),
    /** Honeypot: real people leave this empty. */
    website: z.string().max(0).optional().default(""),
    sites: tags.sites ?? optionalTags([]),
    apps: tags.apps ?? optionalTags([]),
    play: tags.play ?? optionalTags([]),
    create: tags.create ?? optionalTags([]),
  });
}

type ContactData = z.infer<ReturnType<typeof contactSchema>>;

export type ContactState =
  | { status: "idle" }
  | { status: "error"; errors: Record<string, string>; message?: string }
  | { status: "sent" }
  | { status: "fallback"; mailto: string };

function formatInterests(data: ContactData, groups: InterestGroup[]): string | null {
  const lines = groups.flatMap((group) => {
    const picked = data[group.id];
    return picked.length > 0 ? [`${group.label}: ${picked.join(", ")}`] : [];
  });
  return lines.length > 0 ? lines.join("\n") : null;
}

function buildMailto(data: ContactData, groups: InterestGroup[]): string {
  const subject = encodeURIComponent(data.subject || `Project inquiry from ${data.name}`);
  const interests = formatInterests(data, groups);
  const body = encodeURIComponent(
    `${data.message}\n\n—\n${data.name}\n${data.email}${data.budget ? `\nBudget: ${data.budget}` : ""}${interests ? `\n\n${interests}` : ""}`,
  );
  return `mailto:${CONTACT_TO}?subject=${subject}&body=${body}`;
}

/**
 * Sends the contact form through Resend when RESEND_API_KEY is configured.
 * Without a key it returns a prefilled mailto link so the site still works on day one.
 */
export async function sendContact(_prev: ContactState, formData: FormData): Promise<ContactState> {
  const groups = getInterestGroups();
  const schema = contactSchema(groups);
  const interests = Object.fromEntries(groups.map((group) => [group.id, formData.getAll(group.id).map(String)]));
  const scalars = Object.fromEntries([...formData.entries()].filter(([key]) => !groups.some((group) => group.id === key)));
  const parsed = schema.safeParse({ ...scalars, ...interests });
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "form");
      if (!errors[key]) errors[key] = issue.message;
    }
    return { status: "error", errors };
  }

  const data = parsed.data;
  if (data.website) {
    // Bot filled the honeypot. Pretend it worked.
    return { status: "sent" };
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { status: "fallback", mailto: buildMailto(data, groups) };
  }

  try {
    const resend = new Resend(apiKey);
    const { error } = await resend.emails.send({
      from: CONTACT_FROM,
      to: [CONTACT_TO],
      replyTo: data.email,
      subject: data.subject || `New project inquiry from ${data.name}`,
      text: `${data.message}\n\n—\nName: ${data.name}\nEmail: ${data.email}\nBudget: ${data.budget || "not specified"}\n\n${formatInterests(data, groups) ?? "Interests: not specified"}`,
    });
    if (error) {
      return { status: "error", errors: {}, message: "Email service hiccup. Try again or use the mailto link below." };
    }
    return { status: "sent" };
  } catch {
    return { status: "fallback", mailto: buildMailto(data, groups) };
  }
}
