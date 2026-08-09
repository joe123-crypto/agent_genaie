import assert from "node:assert/strict";
import test from "node:test";

import {
  extractExperience,
  extractEducation,
  extractSkills,
  extractContact,
  extractReferee,
  extractDateRange,
} from "@/src/domains/cv-interview";

test("extractExperience pulls company, title and a duration-based range", () => {
  const result = extractExperience(
    "I worked at ABC for 2 years as a frontend developer.",
  );
  assert.equal(result.company, "ABC");
  assert.equal(result.title.toLowerCase(), "frontend developer");
  assert.equal(result.end, "Present");
  const startYear = Number.parseInt(result.start, 10);
  assert.equal(startYear, new Date().getFullYear() - 2);
  // Original wording is preserved as the description.
  assert.match(result.description, /frontend developer/);
});

test("extractExperience handles explicit month-year ranges", () => {
  const result = extractExperience(
    "Senior Engineer at Google from Jan 2019 to March 2022",
  );
  assert.equal(result.company, "Google");
  assert.match(result.title.toLowerCase(), /engineer/);
  assert.equal(result.start, "Jan 2019");
  assert.equal(result.end, "Mar 2022");
});

test("extractExperience recovers company from 'for' and title from role noun", () => {
  const result = extractExperience("I was a product manager for Spotify");
  assert.equal(result.company, "Spotify");
  assert.match(result.title.toLowerCase(), /product manager/);
});

test("extractExperience does not treat a duration as the company", () => {
  const result = extractExperience("I did design work for 3 years");
  assert.equal(result.company, "");
});

test("extractEducation pulls degree, institution and year range", () => {
  const result = extractEducation(
    "BSc Computer Science at Trinity College, 2015-2018",
  );
  assert.match(result.degree, /BSc Computer Science/i);
  assert.match(result.institution, /Trinity/);
  assert.equal(result.start, "2015");
  assert.equal(result.end, "2018");
});

test("extractEducation understands 'present' end and 'from' institution", () => {
  const result = extractEducation("MSc Data Science from MIT since 2023");
  assert.match(result.degree, /MSc Data Science/i);
  assert.match(result.institution, /MIT/);
  assert.equal(result.start, "2023");
  assert.equal(result.end, "Present");
});

test("extractSkills splits commas and 'and', trims and dedupes", () => {
  const result = extractSkills("JavaScript, React and project management, React");
  assert.deepEqual(result, ["JavaScript", "React", "project management"]);
});

test("extractSkills strips a natural-language preamble", () => {
  const result = extractSkills("My skills are Python, SQL and Docker");
  assert.deepEqual(result, ["Python", "SQL", "Docker"]);
});

test("extractContact finds email, phone and location", () => {
  const result = extractContact(
    "You can reach me at jane.doe@example.com or +44 20 7946 0958. I live in London, UK.",
  );
  assert.equal(result.email, "jane.doe@example.com");
  assert.match(result.phone, /\+44/);
  assert.match(result.location, /London/);
});

test("extractReferee finds name, contact and organisation", () => {
  const result = extractReferee(
    "Charles Babbage, my line manager at Cambridge, cb@example.com, +1 555 0111",
  );
  assert.equal(result.name, "Charles Babbage");
  assert.match(result.company, /Cambridge/);
  assert.equal(result.email, "cb@example.com");
  assert.match(result.phone, /555/);
});

test("extractDateRange returns empty range when no dates are present", () => {
  assert.deepEqual(extractDateRange("some role with no dates"), { start: "", end: "" });
});
