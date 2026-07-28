# Junior Developer Assessment — Quote Intelligence MVP

Welcome, and thanks for taking this on. This is a take-home project that mirrors — in
miniature — the kind of problem our team works on every day. It is not a puzzle with one
right answer: it's a realistic, slightly messy job, and we want to see how you think your
way through it.

**Everything in this pack is fictional.** Every company, person, email address, phone
number and price in the sample data was invented for this assessment.

---

## The scenario

**Bokmakierie Events (Pty) Ltd** is an (imaginary) events company. Their procurement
team receives quotes from suppliers all year — staffing agencies, transport companies,
caterers, equipment-hire firms. The quotes arrive as PDFs and Excel files, in whatever
format each supplier happens to use.

The procurement manager has three questions she can't currently answer without digging
through folders by hand:

1. **What have we paid for this service before?**
2. **Are different suppliers charging us differently for the same thing?**
3. **What would a fair price be next time someone quotes us?**

Your job: build the small web app that answers those questions.

In `sample-quotes/` you'll find **51 documents from 10 suppliers spanning roughly a
year** — a mix of PDFs and Excel files. Treat the folder, not this brief, as the
source of truth for what's in the data. Filenames are simply how the documents
arrived.

One grounding fact so you don't have to guess: **all suppliers are South African.**
Assume SA conventions — day/month date order, 15% VAT, prices in ZAR — unless a
document itself says otherwise.

## What to build

A working web application that:

1. **Ingests the sample quotes.** Use [DocuPipe](https://docupipe.ai) to extract
   structured data (supplier, date, quote number, line items with description /
   quantity / unit / rate / total) from the documents. A one-off ingestion script
   run from the command line is perfectly acceptable — the upload flow does not
   need to live in the UI. (The Excel files may be parsed directly with a
   spreadsheet library if you prefer; DocuPipe is required for the PDFs.)
2. **Stores everything in a database** (Postgres — Supabase is a natural fit).
3. **Builds an item catalog.** This is the heart of the assessment. Different suppliers
   describe the same service in different words. Your catalog should converge on **one
   entry per real-world service**, with each supplier's differently-worded lines linked
   to it. How you do the matching is entirely up to you — rules, fuzzy matching,
   embeddings, an LLM, a manual mapping screen, any combination. What we care about:
   - the result is **visible** (you can see what got linked to what), and
   - it is **correctable** (a wrong match can be fixed without editing the database by
     hand — a simple user-facing re-assign control is enough; corrections that survive
     re-ingestion are a bonus, not a requirement).
4. **Shows an item detail view.** Pick any catalog item and see:
   - a **price history chart** over time, per supplier;
   - a **supplier-vs-supplier comparison** of what each charges;
   - a **"fair price" indicator** — your definition, with the reasoning visible in the
     UI (what observations produced this number?).
5. **Lets you browse the catalog.** Search can be basic — a filter box is fine.

## The data is messy on purpose

Real supplier quotes are inconsistent, and this dataset faithfully reproduces that.
Suppliers name the same service differently. They price the same service in different
units. Documents differ in layout, number formatting and date formatting, and some
contain the kinds of surprises real documents contain.

**How you handle the mess is most of the assessment.** We are not expecting you to
solve every inconsistency — we are expecting you to *notice* what the data does,
decide what to do about it, and write those decisions down. A known limitation that
you spotted and consciously deferred, stated in your README, earns credit. A silent
wrong number does not.

Two hints that we'd give any colleague, not spoilers:

- Before you build anything, **open a handful of quotes from different suppliers and
  actually read them.**
- When a comparison looks off, ask: *are these two numbers really in the same unit,
  on the same basis?*

## Ground rules

- **Stack:** React + TypeScript frontend. Supabase or any Postgres for the backend.
  Beyond that, your choice of libraries.
- **DocuPipe:** sign up for your own free account at docupipe.ai. Designing the
  extraction schema is part of the task. Practical advice: **test your schema on 2–3
  documents before running all 51.** As of writing, a new account starts with roughly
  300 credits and a full pass over this pack costs very roughly 150 — check the
  current numbers when you sign up, and budget for one or two full passes, not ten.
  **If you run out of credits through no fault of your own, email us — we'll sort out
  access, and running out will not count against you.**
- **AI tools are allowed and expected.** Use Claude, Copilot, ChatGPT, whatever you
  normally use. The only rule: in the walkthrough call you must be able to explain
  every decision and every part of the code as your own. "The AI wrote it and I'm not
  sure" is the one wrong answer.
- **Questions are welcome.** Email **ty@supatech.co.za**. Asking a sharp question
  counts in your favour, not against you.

## What we are NOT expecting

- No authentication, user accounts or multi-tenancy.
- No pixel-perfect design — clean and usable beats beautiful.
- No handling of every edge case — but do *name* the ones you saw and skipped.
- No production deployment — running locally with clear instructions is fine (a hosted
  URL is a nice-to-have, not a requirement).

## Deliverables

1. **A git repository** (private GitHub repo; invite **`SupaTyb`** as a collaborator
   so we can review it) with your code and commit history — commit as you go, we
   like seeing the path.
2. **Run instructions** that work on a machine that isn't yours (or a hosted URL).
3. **A README** covering: your extraction schema and why; how your catalog matching
   works; how you defined "fair price"; every judgement call you made about the messy
   data; known limitations; and what you would do next with another week.
4. **A 30-minute walkthrough call** where you demo the app and we talk through your
   decisions.

## Effort

Expect roughly **3–4 focused days** of actual effort. If you find yourself
gold-plating past that, stop and write the README instead — scoping is part of the
job. The submission deadline and payment arrangements are agreed directly with you
by email, not fixed in this brief — if we haven't confirmed yours yet, ask.

## The fine print

- **Your submission remains yours.** We will not use your code or your write-up in
  our product. This is an assessment, not free work.
- The sample data is fictional and carries no confidentiality obligations; feel free
  to keep your solution in your portfolio after the process — including making the
  repo public once the process has concluded (a note that the dataset came from a
  hiring assessment is appreciated).

## How we evaluate

No hidden criteria — this is the actual list:

| What | Weight |
|---|---|
| Extraction & ingestion correctness | 15% |
| Catalog quality — wrong merges hurt as much as missed ones | 25% |
| Unit & pricing-basis handling | 20% |
| Fair price & history — sound reasoning, honest display | 15% |
| Product & UI clarity for a non-technical user | 10% |
| Code quality | 10% |
| Communication — README and walkthrough | 5% |

Good luck — we're looking forward to seeing what you build.
