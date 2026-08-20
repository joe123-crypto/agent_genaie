// Server entry point for CV HTML generation.
//
// The rendering core + template registry lives in ./cv-templates.ts, a
// client-safe module (no firebase-admin imports) so the create-cv form can
// render a live preview in the browser through the exact same code path used to
// save the CV. This file re-exports that surface and adds the server build
// helper.

import {
  renderCvHtml,
  type CvInput,
} from "./cv-templates";

export {
  normalizeCvInput,
  renderCvHtml,
  resolveTemplate,
  isValidTemplateId,
  CV_TEMPLATES,
  DEFAULT_TEMPLATE_ID,
} from "./cv-templates";

export type {
  CvInput,
  CvExperienceInput,
  CvEducationInput,
  CvRefereeInput,
  NormalizedCv,
  CvTemplate,
  RenderCvOptions,
} from "./cv-templates";

// Build the canonical CV HTML for saving. `templateId` selects the styling
// (falls back to the default template on unknown/absent ids). The name is
// required here (no preview relaxation), matching the create route's contract.
export function buildCvHtml(input: CvInput, templateId?: string): string {
  return renderCvHtml(input, templateId);
}
