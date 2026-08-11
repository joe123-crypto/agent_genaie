import assert from "node:assert/strict";
import test from "node:test";

import { parseInterviewTurn } from "@/src/domains/cv-interview-ai";

test("parseInterviewTurn reads a clean JSON object", () => {
  const turn = parseInterviewTurn(
    JSON.stringify({
      reply: "What's your full name?",
      data: {
        fullName: "Ada Lovelace",
        email: "ada@example.com",
        phone: "",
        location: "London",
        summary: "",
        skills: "maths, analysis",
        experience: [],
        education: [],
        referees: [],
      },
      complete: false,
    }),
  );

  assert.equal(turn.reply, "What's your full name?");
  assert.equal(turn.complete, false);
  assert.equal(turn.data.fullName, "Ada Lovelace");
  assert.equal(turn.data.location, "London");
  assert.equal(turn.data.skills, "maths, analysis");
});

test("parseInterviewTurn unwraps a fenced ```json block", () => {
  const raw = "```json\n" + JSON.stringify({ reply: "hi", data: {}, complete: true }) + "\n```";
  const turn = parseInterviewTurn(raw);
  assert.equal(turn.reply, "hi");
  assert.equal(turn.complete, true);
});

test("parseInterviewTurn recovers a JSON object wrapped in prose", () => {
  const raw = 'Sure! {"reply": "next?", "data": {}, "complete": false} hope that helps';
  const turn = parseInterviewTurn(raw);
  assert.equal(turn.reply, "next?");
});

test("parseInterviewTurn drops empty/malformed rows but keeps good ones", () => {
  const turn = parseInterviewTurn(
    JSON.stringify({
      reply: "another role?",
      data: {
        experience: [
          { title: "Engineer", company: "ABC", start: "2020", end: "2022", description: "built things" },
          { title: "", company: "", start: "", end: "", description: "" },
          "garbage",
        ],
        education: [{ degree: "BSc", institution: "MIT" }],
        referees: [{ name: "", position: "", company: "", email: "", phone: "" }],
      },
      complete: false,
    }),
  );

  assert.equal(turn.data.experience.length, 1);
  assert.equal(turn.data.experience[0].title, "Engineer");
  // Missing fields are normalized to empty strings, not left undefined.
  assert.equal(turn.data.education[0].start, "");
  assert.equal(turn.data.education.length, 1);
  // The all-empty placeholder referee is discarded.
  assert.equal(turn.data.referees.length, 0);
});

test("parseInterviewTurn coerces non-string scalar fields", () => {
  const turn = parseInterviewTurn(
    JSON.stringify({ reply: "ok", data: { fullName: 42, skills: null }, complete: false }),
  );
  assert.equal(turn.data.fullName, "");
  assert.equal(turn.data.skills, "");
});

test("parseInterviewTurn throws when there is no JSON object", () => {
  assert.throws(() => parseInterviewTurn("I could not do that."));
});

test("parseInterviewTurn throws when the reply is missing", () => {
  assert.throws(() => parseInterviewTurn(JSON.stringify({ data: {}, complete: false })));
});
