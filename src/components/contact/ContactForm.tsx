"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { sendContact, type ContactState } from "@/app/contact/actions";
import type { InterestGroup } from "@/lib/content";
import { EASE_CURVE, springy } from "@/lib/motion";
import { sfx } from "@/lib/sfx";
import { burstAt } from "@/components/fx/ParticleBurst";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import { launchPlane } from "@/worlds/scenes/planes/launch";

const BUDGETS = ["Under $1k", "$1k – $3k", "$3k – $8k", "$8k+", "Not sure yet"];

interface Props {
  defaultSubject?: string;
  interests: InterestGroup[];
}

export function ContactForm({ defaultSubject = "", interests }: Props) {
  const [state, action, pending] = useActionState<ContactState, FormData>(sendContact, { status: "idle" });
  const [budget, setBudget] = useState("");
  const card = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (state.status === "sent" || state.status === "fallback") launchPlane();
    if (state.status === "sent") {
      sfx.success();
      const r = card.current?.getBoundingClientRect();
      if (r) burstAt(r.left + r.width / 2, r.top + 80, 40);
    }
    if (state.status === "fallback") {
      sfx.success();
      window.location.href = state.mailto;
    }
    if (state.status === "error") sfx.pop();
  }, [state]);

  const errors = state.status === "error" ? state.errors : {};

  return (
    <div ref={card} className="card relative overflow-hidden p-6 md:p-10">
      <AnimatePresence mode="wait">
        {state.status === "sent" ? (
          <motion.div
            key="sent"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.6, ease: EASE_CURVE.bounce }}
            className="py-16 text-center"
          >
            <motion.span
              className="world-gradient mx-auto grid h-24 w-24 place-items-center rounded-full text-5xl"
              animate={{ rotate: [0, -10, 10, 0], scale: [1, 1.1, 1] }}
              transition={{ duration: 1.2, repeat: Infinity, repeatDelay: 1.5 }}
            >
              🌱
            </motion.span>
            <h3 className="font-display mt-8 text-3xl font-bold md:text-4xl">Planted.</h3>
            <p className="mx-auto mt-3 max-w-md text-[var(--ink-soft)]">
              Your message is in my inbox. I reply to every note, usually within two working days.
            </p>
            <div className="mt-8">
              <Button href="/">Back to the valley</Button>
            </div>
          </motion.div>
        ) : (
          <motion.form key="form" action={action} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
            <div className="grid gap-6 md:grid-cols-2">
              <Field label="Your name" name="name" error={errors.name} autoComplete="name" placeholder="Ada Lovelace" />
              <Field label="Email" name="email" type="email" error={errors.email} autoComplete="email" placeholder="ada@example.com" />
            </div>
            <Field label="What is it about?" name="subject" defaultValue={defaultSubject} placeholder="A website, an app, a template..." />

            <fieldset>
              <legend className="font-display text-sm font-bold">
                What should it include? <span className="font-normal text-[var(--ink-mute)]">(optional)</span>
              </legend>
              <div className="mt-4 space-y-6">
                {interests.map((group) => (
                  <fieldset key={group.id}>
                    <legend className="font-display mb-3 text-sm font-bold">
                      {group.emoji} {group.label}
                    </legend>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {group.options.map((option) => (
                        <label
                          key={option}
                          data-sfx="silent"
                          className="flex cursor-pointer items-center gap-3 rounded-2xl border border-[var(--line)] bg-[var(--bg)] px-4 py-3 font-display text-sm font-bold transition-colors has-checked:border-[var(--ink)] has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-[var(--world-a)]/40"
                        >
                          <input
                            type="checkbox"
                            name={group.id}
                            value={option}
                            onChange={() => sfx.pop()}
                            className="size-4 shrink-0 accent-[var(--moss)]"
                          />
                          {option}
                        </label>
                      ))}
                    </div>
                    <AnimatePresence>
                      {errors[group.id] && (
                        <motion.span
                          initial={{ opacity: 0, y: -4 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0 }}
                          className="mt-1.5 block text-sm font-bold text-[var(--petal)]"
                        >
                          {errors[group.id]}
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </fieldset>
                ))}
              </div>
            </fieldset>

            <fieldset>
              <legend className="font-display mb-3 text-sm font-bold">Budget (optional)</legend>
              <input type="hidden" name="budget" value={budget} />
              <div className="flex flex-wrap gap-2">
                {BUDGETS.map((b) => (
                  <button
                    key={b}
                    type="button"
                    data-sfx="silent"
                    onClick={() => {
                      setBudget(budget === b ? "" : b);
                      sfx.pop();
                    }}
                    className={cn(
                      "font-display relative h-10 rounded-full px-4 text-sm font-bold transition-colors",
                      budget === b ? "text-[#1b2a22]" : "border border-[var(--line)] hover:border-[var(--ink)]",
                    )}
                  >
                    {budget === b && <motion.span layoutId="budget-pill" className="world-gradient absolute inset-0 -z-10 rounded-full" transition={springy} />}
                    <span className="relative">{b}</span>
                  </button>
                ))}
              </div>
            </fieldset>

            <Field label="Tell me about it" name="message" textarea error={errors.message} placeholder="What are you making? Who is it for? When do you need it?" />

            {/* Honeypot */}
            <div className="absolute -left-[9999px] top-0" aria-hidden>
              <label>
                Website
                <input type="text" name="website" tabIndex={-1} autoComplete="off" />
              </label>
            </div>

            {state.status === "error" && state.message && <p className="text-sm font-bold text-[var(--petal)]">{state.message}</p>}

            <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
              <p className="text-sm text-[var(--ink-mute)]">
                Or email{" "}
                <a href="mailto:hello@davisdigitaldesigns.com" className="font-bold text-[var(--ink)] underline underline-offset-4">
                  hello@davisdigitaldesigns.com
                </a>
              </p>
              <Button type="submit" size="lg" variant="world" disabled={pending} className={cn(pending && "opacity-70")}>
                {pending ? "Sending…" : "Send it"}
              </Button>
            </div>
          </motion.form>
        )}
      </AnimatePresence>
    </div>
  );
}

interface FieldProps {
  label: string;
  name: string;
  type?: string;
  error?: string;
  placeholder?: string;
  textarea?: boolean;
  autoComplete?: string;
  defaultValue?: string;
}

function Field({ label, name, type = "text", error, placeholder, textarea, autoComplete, defaultValue }: FieldProps) {
  const cls = cn(
    "peer w-full rounded-2xl border bg-[var(--bg)] px-4 py-3.5 text-base outline-none transition-all duration-300 placeholder:text-[var(--ink-mute)] focus:-translate-y-0.5 focus:shadow-[var(--shadow-soft)] focus:ring-4 focus:ring-[var(--world-a)]/40",
    error ? "border-[var(--petal)]" : "border-[var(--line)] focus:border-[var(--ink)]",
  );
  return (
    <label className="block">
      <span className="font-display mb-2 block text-sm font-bold">{label}</span>
      {textarea ? (
        <textarea name={name} rows={5} placeholder={placeholder} defaultValue={defaultValue} className={cn(cls, "resize-y")} />
      ) : (
        <input name={name} type={type} placeholder={placeholder} autoComplete={autoComplete} defaultValue={defaultValue} className={cls} />
      )}
      <AnimatePresence>
        {error && (
          <motion.span
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="mt-1.5 block text-sm font-bold text-[var(--petal)]"
          >
            {error}
          </motion.span>
        )}
      </AnimatePresence>
    </label>
  );
}
