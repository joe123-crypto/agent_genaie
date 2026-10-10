// The CV maker (chat interview, form, payment proof, CV download) lives in its
// own app, genaie-cv. It shares this app's Firebase project, so the same
// publicUserId-scoped paths work there. NEXT_PUBLIC_ so client components can
// build links to it.
export const CV_APP_URL = (process.env.NEXT_PUBLIC_CV_APP_URL?.trim() || "http://localhost:3020").replace(/\/+$/, "");

export function cvAppHref(path = "/") {
  const safePath = path.startsWith("/") && !path.startsWith("//") ? path : "/";
  return `${CV_APP_URL}${safePath}`;
}
