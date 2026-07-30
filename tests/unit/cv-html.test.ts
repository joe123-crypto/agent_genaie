import assert from "node:assert/strict";
import test from "node:test";

import { buildCvHtml, normalizeCvInput } from "@/src/domains/cv-html";
import { validateCanonicalCvHtml } from "@/src/domains/job-scout";

const sample = {
  fullName: "Ada <Lovelace>",
  email: "ada@example.com",
  phone: "+1 555 0100",
  location: "London",
  summary: "Analyst & \"engineer\".\n\nBuilt the <first> algorithm.\nLoves url(//evil.example/x) jokes.",
  experience: [
    {
      title: "Lead Engineer",
      company: "Analytical Engines <Ltd>",
      start: "Jan 2020",
      end: "Present",
      description: "Shipped onload=alert(1) safely & wrote docs.",
    },
    { title: "", company: "", description: "" },
  ],
  education: [
    { degree: "BSc Mathematics", institution: "Trinity", start: "2015", end: "2018" },
  ],
  skills: "JavaScript, JavaScript, React, <b>Design</b>",
};

test("buildCvHtml produces canonical CV HTML that passes validation", () => {
  const html = buildCvHtml(sample);
  // validateCanonicalCvHtml throws on anything unsafe; it should accept our output.
  assert.doesNotThrow(() => validateCanonicalCvHtml(Buffer.from(html, "utf8")));
  assert.match(html, /<html/i);
  assert.match(html, /<body/i);
});

test("buildCvHtml escapes user input and neutralizes dangerous sequences", () => {
  const html = buildCvHtml(sample);
  // Raw angle brackets from user input must be escaped, not rendered as tags.
  assert.ok(!html.includes("<Lovelace>"));
  assert.ok(html.includes("Ada &lt;Lovelace&gt;"));
  assert.ok(html.includes("&lt;b&gt;Design&lt;/b&gt;"));
  // No executable or external-reference sequences survive validation.
  assert.doesNotThrow(() => validateCanonicalCvHtml(Buffer.from(html, "utf8")));
});

test("normalizeCvInput requires a full name and drops empty rows", () => {
  assert.throws(() => normalizeCvInput({ fullName: "   " }), /Full name is required/);
  const cv = normalizeCvInput(sample);
  assert.equal(cv.experience.length, 1);
  assert.deepEqual(cv.skills, ["JavaScript", "React", "<b>Design</b>"]);
});

test("education section heading covers certifications", () => {
  const html = buildCvHtml(sample);
  assert.match(html, /<h2>Education &amp; Certifications<\/h2>/);
});
